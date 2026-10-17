"""Evidence-backed generation: explicit grouping and multi-scenario traceability."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from design_evidence import extract_design_scenarios, gwt_scenarios
from document_model import IdentityAllocator, build_model, derive_functions, derive_tests, enrich_tests_from_plan


def requirement(identity, statement):
    return {"id": identity, "statement": statement, "kind": "functional-requirement",
            "status": "current", "priority": "P1", "source_refs": ["spec.md#L1"]}


class RicherDerivationTests(unittest.TestCase):
    def test_no_story_explicit_capability_groups_but_generic_verb_does_not(self):
        requirements = [requirement("FR-001", "[Capability: Order registration] Create orders."),
                        requirement("FR-002", "[Capability: Order registration] Reject duplicate orders."),
                        requirement("FR-003", "Create employee accounts.")]
        allocator = IdentityAllocator(None)
        functions, links = derive_functions(requirements, allocator)
        self.assertEqual(len(functions), 2)
        targets = {link["from_id"]: link["to_id"] for link in links}
        self.assertEqual(targets["FR-001"], targets["FR-002"])
        self.assertNotEqual(targets["FR-001"], targets["FR-003"])
        self.assertTrue(allocator.questions)
        self.assertTrue(all(fn["basis"] == "derived" for fn in functions))

    def test_no_story_unlabelled_candidates_require_boundary_review(self):
        allocator = IdentityAllocator(None)
        functions, _ = derive_functions([requirement("FR-001", "Create orders."), requirement("FR-002", "Create employees.")], allocator)
        self.assertEqual(len(functions), 2)
        self.assertEqual(len(allocator.questions), 2)

    def test_ordinary_reference_does_not_assert_same_capability(self):
        allocator = IdentityAllocator(None)
        functions, _ = derive_functions([requirement("FR-001", "Create orders."), requirement("FR-002", "Unlike FR-001, create employees.")], allocator)
        self.assertEqual(len(functions), 2)

    def test_one_requirement_multiple_explicit_gwt_tests(self):
        reqs = [requirement("FR-001", "Given an empty list, When A is added, Then A is visible.\nGiven A exists, When A is added, Then duplicate is rejected.")]
        allocator = IdentityAllocator(None)
        functions, links = derive_functions(reqs, allocator)
        tests, links = derive_tests(reqs, functions, links, allocator, False)
        self.assertEqual(len(tests), 2)
        self.assertEqual({test["type"] for test in tests}, {"positive", "negative"})
        self.assertEqual({test["expected_result"] for test in tests}, {"A is visible.", "duplicate is rejected."})
        self.assertEqual(sum(link["type"] == "requirement-to-test" for link in links), 2)

    def test_multiline_markdown_gwt_uses_explicit_heading_scope(self):
        scenarios, consumed = extract_design_scenarios("# FR-001\n\n**Given**: draft order\n**When**: approve order\n**Then**: approved order\n", {"FR-001"})
        self.assertEqual(len(scenarios), 1)
        self.assertEqual(scenarios[0]["steps"], ["approve order"])
        self.assertEqual(scenarios[0]["requirement_ids"], ["FR-001"])
        self.assertIn(1, consumed)
        self.assertEqual(scenarios[0]["test_data"], [])

    def test_sibling_heading_does_not_inherit_unrelated_requirements(self):
        scenarios, _ = extract_design_scenarios("# FR-001\nGiven A, When B, Then C.\n# Other\nGiven X, When Y, Then Z.\n", {"FR-001"})
        self.assertEqual(len(scenarios), 1)

    def test_fenced_example_is_not_promoted_or_consumed(self):
        text = "# FR-001\n```text\nGiven fake, When fake, Then fake.\n```\nGiven real, When action, Then observed.\n"
        scenarios, consumed = extract_design_scenarios(text, {"FR-001"})
        self.assertEqual(len(scenarios), 1)
        self.assertEqual(scenarios[0]["expected_result"], "observed.")
        self.assertNotIn(3, consumed)

    def test_multiple_contract_pairs_are_not_overwritten(self):
        text = "# FR-001\nRequest: GET /items/1\nResponse: 200 item 1\nRequest: GET /items/2\nResponse: 404 not found\n"
        scenarios, _ = extract_design_scenarios(text, {"FR-001"}, contract=True)
        self.assertEqual(len(scenarios), 2)
        self.assertEqual({s["expected_result"] for s in scenarios}, {"200 item 1", "404 not found"})

    def test_nested_heading_inherits_scope_and_inline_scenarios_keep_own_ids(self):
        scenarios, _ = extract_design_scenarios("# FR-001\n## Happy path\nGiven A, When B, Then C.\n# Independent\nFR-001 Given D, When E, Then F.\nFR-002 Given X, When Y, Then Z.\n", {"FR-001", "FR-002"})
        self.assertEqual([item["requirement_ids"] for item in scenarios], [["FR-001"], ["FR-001"], ["FR-002"]])

    def test_literal_expected_value_is_not_stripped_of_its_quoting(self):
        scenario = gwt_scenarios("Given a label, When rendered, Then literal `TBD` is shown.")[0]
        self.assertEqual(scenario["expected_result"], "literal `TBD` is shown.")

    def test_state_table_only_uses_declared_states_and_data(self):
        text = "# States\n| Requirement | From | Event | To | Test data |\n|---|---|---|---|---|\n| FR-001 | pending | approve | approved | order A |\n| FR-001 | approved | cancel | cancelled | order B |\n"
        scenarios, _ = extract_design_scenarios(text, {"FR-001"})
        self.assertEqual(len(scenarios), 2)
        self.assertEqual(scenarios[1]["expected_result"], "cancelled")
        self.assertEqual(scenarios[1]["test_data"], ["order B"])

    def test_contract_request_response_no_invented_precondition_or_error(self):
        text = "# FR-001\nRequest: POST /orders with order A\nResponse: 201 with order identifier\n"
        scenarios, _ = extract_design_scenarios(text, {"FR-001"}, contract=True)
        self.assertEqual(len(scenarios), 1)
        self.assertEqual(scenarios[0]["preconditions"], [])
        self.assertEqual(scenarios[0]["expected_result"], "201 with order identifier")
        self.assertEqual(scenarios[0]["test_data"], [])
        self.assertEqual(extract_design_scenarios("# FR-001\nRequest: POST /orders\n", {"FR-001"}, contract=True)[0], [])

    def test_enriched_scenario_is_shared_across_requirements_and_functions(self):
        reqs = [requirement("FR-001", "Create order."), requirement("FR-002", "Settle payment.")]
        allocator = IdentityAllocator(None)
        functions, links = derive_functions(reqs, allocator)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "quickstart.md").write_text("# FR-001 FR-002\nGiven an unpaid order,\nWhen checkout completes,\nThen order is paid.\n", encoding="utf-8")
            tests, links, unresolved = enrich_tests_from_plan(root, reqs, functions, [], links, allocator)
        self.assertEqual(len(tests), 1)
        self.assertEqual(sum(link["type"] == "requirement-to-test" for link in links), 2)
        self.assertEqual(sum(link["type"] == "function-to-test" for link in links), 2)
        self.assertEqual(unresolved, [])

    def test_duplicate_scenario_merges_requirement_links_and_source_evidence(self):
        reqs = [requirement("FR-001", "Create order."), requirement("FR-002", "Settle payment.")]
        allocator = IdentityAllocator(None)
        functions, links = derive_functions(reqs, allocator)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "quickstart.md").write_text("# FR-001\nGiven A, When B, Then C.\n\n# FR-002\nGiven A, When B, Then C.\n", encoding="utf-8")
            tests, links, _ = enrich_tests_from_plan(root, reqs, functions, [], links, allocator)
        self.assertEqual(len(tests), 1)
        self.assertEqual(sum(link["type"] == "requirement-to-test" for link in links), 2)
        self.assertIn("quickstart.md#L5", tests[0]["source_refs"])

    def test_unstructured_contract_is_retained_not_guessed(self):
        reqs = [requirement("FR-001", "Create order.")]
        allocator = IdentityAllocator(None)
        functions, links = derive_functions(reqs, allocator)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "plan.md").write_text("# Plan\nRetry eventually.\n", encoding="utf-8")
            tests, _, unresolved = enrich_tests_from_plan(root, reqs, functions, [], links, allocator)
        self.assertEqual(tests, [])
        self.assertIn("Retry eventually.", unresolved[0]["content"])
        self.assertTrue(allocator.questions)


if __name__ == "__main__":
    unittest.main()
