"""Regression checks for domain-independent derivation and identity lifecycle."""
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "evals" / "fixtures"
sys.path.insert(0, str(ROOT / "scripts"))
from document_model import build_model, evaluate_model, IdentityAllocator


class GeneralizationTests(unittest.TestCase):
    def model(self, text, existing=None, extras=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "spec.md").write_text(text, encoding="utf-8")
            for name, content in (extras or {}).items():
                (root / name).parent.mkdir(parents=True, exist_ok=True)
                (root / name).write_text(content, encoding="utf-8")
            return build_model(root, existing=existing)

    def test_unknown_heading_explicit_id_and_multiline(self):
        model = self.model("# Archive\n## Obligations\n- FR-913: Archive receipts\n  for seven years.\n")
        req = next(req for req in model["requirements"] if req["id"] == "FR-913")
        self.assertIn("seven years", req["statement"])
        self.assertTrue(model["open_questions"])
        self.assertEqual(evaluate_model(model, profile="publish")["status"], "blocked")

    def test_gwt_parts_and_all_requirement_test_coverage(self):
        model = self.model("# Archive\n## Requirements\n- FR-913: Given an empty archive, When a receipt is uploaded, Then one receipt is stored.\n- FR-914: Receipts are searchable.\n")
        test = next(test for test in model["test_cases"] if "FR-913" in test["title"])
        self.assertEqual(test["preconditions"], ["an empty archive"])
        self.assertEqual(test["steps"], ["a receipt is uploaded"])
        self.assertEqual(test["expected_result"], "one receipt is stored.")
        model["links"] = [link for link in model["links"] if not (link["type"] == "requirement-to-test" and link["from_id"] == "FR-914")]
        self.assertTrue(evaluate_model(model)["axes"]["test_coverage"]["errors"])

    def test_allocator_retires_removed_function_and_tests(self):
        old = self.model("# Archive\n## Requirements\n- FR-913: Archive receipts.\n- FR-914: Delete receipts.\n")
        new = self.model("# Archive\n## Requirements\n- FR-913: Archive receipts.\n", existing=old)
        removed = {entry["id"] for entry in old["identity_registry"]} - {item["id"] for item in new["requirements"] + new["functions"] + new["test_cases"]}
        self.assertTrue(removed)
        self.assertTrue(all(entry["lifecycle"] == "retired" for entry in new["identity_registry"] if entry["id"] in removed))
        again = self.model("# Archive\n## Requirements\n- FR-913: Archive receipts.\n", existing=new)
        self.assertEqual(new["identity_registry"], again["identity_registry"])

    def test_japanese_gwt_separator_and_negative_category(self):
        model = build_model(FIXTURES / "spec-only")
        positive = next(test for test in model["test_cases"] if test["title"].endswith("AC-001"))
        negative = next(test for test in model["test_cases"] if test["title"].endswith("AC-002"))
        self.assertEqual(positive["preconditions"], ["通知先が未登録"])
        self.assertEqual(positive["steps"], ["有効なメールアドレスを登録する"])
        self.assertEqual(positive["expected_result"], "通知先一覧に登録値が表示される。")
        self.assertEqual(negative["type"], "negative")

    def test_generated_ids_never_reuse_retired_or_duplicate_new_ids(self):
        old = self.model("# Archive\n## Edge Cases\n- Alpha is unavailable.\n- Beta is unavailable.\n")
        new = self.model("# Archive\n## Edge Cases\n- Gamma is unavailable.\n- Delta is unavailable.\n", existing=old)
        identities = [req["id"] for req in new["requirements"]]
        self.assertEqual(len(identities), len(set(identities)))
        self.assertFalse(set(identities) & {req["id"] for req in old["requirements"]})

    def test_retired_allocator_key_cannot_reactivate_old_id(self):
        allocator = IdentityAllocator({"identity_registry": [{"id": "FNC-009", "kind": "function", "source_key": "x", "lifecycle": "retired"}]})
        self.assertEqual(allocator.allocate("function", "x"), "FNC-010")

    def test_fixture_ids_do_not_create_recovery_or_transaction_claims(self):
        model = self.model("# Archive\n## Requirements\n- FR-020: Archive receipts.\n- FR-021: Delete receipts.\n## Success Criteria\n- SC-003: 100 receipts archived.\n", extras={
            "plan.md": "# Plan\nUse same transaction.\n",
            "research.md": "# Research\ntransactional outbox\n",
            "data-model.md": "# Data\n| Name | Type | Size | Description |\n| Receipt | string | 20 | name |\n",
            "quickstart.md": "# Steps\n1. manual resend isolated\n",
        })
        self.assertFalse(any(test["level"] != "logical-acceptance" for test in model["test_cases"]))
        self.assertTrue(model["unclassified"])
        self.assertEqual(evaluate_model(model, profile="publish")["status"], "blocked")

    def test_story_capability_groups_requirements_constraints_and_tests(self):
        model = build_model(FIXTURES / "spec-only")
        self.assertEqual(len(model["functions"]), 1)
        function_id = model["functions"][0]["id"]
        linked_requirements = {link["from_id"] for link in model["links"] if link["type"] == "requirement-to-function" and link["to_id"] == function_id}
        self.assertEqual(linked_requirements, {"US-001", "AC-001", "AC-002", "EC-001", "FR-001", "FR-002", "FR-003", "SC-001"})
        linked_tests = {link["to_id"] for link in model["links"] if link["type"] == "function-to-test" and link["from_id"] == function_id}
        self.assertEqual(len(linked_tests), 8)
        self.assertEqual(len(model["test_cases"]), 8)

    def test_business_rule_worded_differently_stays_with_story_capability(self):
        model = build_model(FIXTURES / "unresolved-quality")
        self.assertEqual(len(model["functions"]), 1)
        function_id = model["functions"][0]["id"]
        linked = {link["from_id"] for link in model["links"] if link["type"] == "requirement-to-function" and link["to_id"] == function_id}
        self.assertIn("FR-002", linked)
        self.assertIn("SC-001", linked)

    def test_multiple_stories_form_separate_capabilities(self):
        model = self.model("""# Orders
## User Scenarios & Testing
### User Story 1 - 注文を登録する (Priority: P1)
担当者は注文を登録する。
### User Story 2 - 注文を取消する (Priority: P2)
担当者は注文を取消する。
## Requirements
- FR-001: 担当者は注文を登録できなければならない。
- FR-002: 担当者は注文を取消できなければならない。
""")
        self.assertEqual(len(model["functions"]), 2)
        links = {(link["from_id"], link["to_id"]) for link in model["links"] if link["type"] == "requirement-to-function"}
        story_functions = {req: fn for req, fn in links if req.startswith("US-")}
        self.assertIn(("FR-001", story_functions["US-001"]), links)
        self.assertIn(("FR-002", story_functions["US-002"]), links)

    def test_cross_cutting_nfr_can_link_to_multiple_capabilities(self):
        model = self.model("""# Orders
## User Scenarios & Testing
### User Story 1 - 注文を登録する (Priority: P1)
担当者は注文を登録する。
### User Story 2 - 注文を取消する (Priority: P2)
担当者は注文を取消する。
## Requirements
- NFR-001: すべての操作は監査記録を残さなければならない。
""")
        targets = {link["to_id"] for link in model["links"] if link["type"] == "requirement-to-function" and link["from_id"] == "NFR-001"}
        self.assertEqual(targets, {function["id"] for function in model["functions"]})
        test_id = next(link["to_id"] for link in model["links"] if link["type"] == "requirement-to-test" and link["from_id"] == "NFR-001")
        test_functions = {link["from_id"] for link in model["links"] if link["type"] == "function-to-test" and link["to_id"] == test_id}
        self.assertEqual(test_functions, targets)

    def test_unreviewed_single_requirement_function_blocks_publish(self):
        model = self.model("""# Archive
## Requirements
- FR-001: Receipts can be archived.
- FR-002: Receipts can be deleted.
""")
        draft = evaluate_model(model, profile="draft")
        publish = evaluate_model(model, profile="publish")
        self.assertTrue(any("mirrors a single requirement" in warning for warning in draft["axes"]["function_coverage"]["warnings"]))
        self.assertTrue(any("mirrors a single requirement" in error for error in publish["axes"]["function_coverage"]["errors"]))

    def test_unrelated_functional_requirement_is_not_forced_into_only_story(self):
        model = self.model("""# Orders
## User Scenarios & Testing
### User Story 1 - 注文を登録する (Priority: P1)
担当者は注文を登録する。
## Requirements
- FR-001: 管理者は倉庫マスタを削除できなければならない。
""")
        self.assertEqual(len(model["functions"]), 2)
        story_function = next(link["to_id"] for link in model["links"] if link["type"] == "requirement-to-function" and link["from_id"] == "US-001")
        requirement_function = next(link["to_id"] for link in model["links"] if link["type"] == "requirement-to-function" and link["from_id"] == "FR-001")
        self.assertNotEqual(story_function, requirement_function)


if __name__ == "__main__":
    unittest.main()
