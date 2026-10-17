from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
FIXTURES = ROOT / "evals" / "fixtures"
sys.path.insert(0, str(SCRIPTS))

from document_model import build_model, evaluate_model, extract_requirements, json_text  # noqa: E402
from render_documents import rendered_files, review_html, safe_stem, write_rendered  # noqa: E402


class ExtractionTest(unittest.TestCase):
    def test_complete_v1_shape_extracts_normative_items(self) -> None:
        model = build_model(FIXTURES / "complete-feature", mode="auto", profile="publish")
        kinds = [item["kind"] for item in model["requirements"]]
        self.assertEqual(model["mode"], "plan-enriched")
        self.assertEqual(kinds.count("user-story"), 2)
        self.assertEqual(kinds.count("acceptance-scenario"), 4)
        self.assertEqual(kinds.count("functional-requirement"), 6)
        self.assertEqual(kinds.count("edge-case"), 2)
        self.assertEqual(kinds.count("success-criterion"), 3)
        self.assertGreater(model["report"]["blocking_errors"], 0)

    def test_japanese_custom_headings(self) -> None:
        model = build_model(FIXTURES / "japanese-custom-headings")
        ids = {item["id"] for item in model["requirements"]}
        self.assertTrue({"FR-001", "FR-002", "FR-003", "SC-001"}.issubset(ids))
        self.assertEqual(sum(item["kind"] == "acceptance-scenario" for item in model["requirements"]), 2)
        self.assertFalse(model["unclassified"])

    def test_code_fence_does_not_create_heading_or_requirement(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            feature = Path(temporary)
            (feature / "spec.md").write_text(
                "# Feature Specification: Safe\n\n## User Scenarios & Testing\n\n### User Story 1 - View (Priority: P1)\n\n**Acceptance Scenarios**:\n\n1. Given a record, When viewed, Then it is shown.\n\n## Requirements\n\n- **FR-001**: A record can be viewed.\n\n```md\n## Requirements\n- **FR-999**: fake\n```\n",
                encoding="utf-8",
            )
            model = build_model(feature)
            self.assertNotIn("FR-999", {item["id"] for item in model["requirements"]})

    def test_duplicate_explicit_requirement_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "spec.md"
            path.write_text("# X\n## Requirements\n- **FR-001**: One.\n- **FR-001**: Two.\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate explicit"):
                extract_requirements(path)

    def test_generated_identity_survives_reordering(self) -> None:
        fixture = FIXTURES / "spec-only"
        first = build_model(fixture)
        second = build_model(fixture, existing=first)
        first_pairs = {(item["kind"], item["statement"]): item["id"] for item in first["requirements"]}
        second_pairs = {(item["kind"], item["statement"]): item["id"] for item in second["requirements"]}
        self.assertEqual(first_pairs, second_pairs)


class ModelQualityTest(unittest.TestCase):
    def test_all_current_nodes_have_bidirectional_chain(self) -> None:
        model = build_model(FIXTURES / "complete-feature", mode="plan-enriched", profile="publish")
        report = evaluate_model(model, FIXTURES / "complete-feature", "publish")
        self.assertEqual(report["status"], "blocked")
        self.assertTrue(model["open_questions"])
        for axis in ("cross_artifact_consistency",):
            self.assertEqual(report["axes"][axis]["errors"], [])
        self.assertTrue(report["axes"]["function_coverage"]["errors"])
        self.assertEqual(evaluate_model(model, profile="draft")["axes"]["function_coverage"]["errors"], [])
        self.assertTrue(all("concrete test operation/expectation is unresolved" in error for error in report["axes"]["test_coverage"]["errors"]))
        req_test = {item["from_id"] for item in model["links"] if item["type"] == "requirement-to-test"}
        self.assertTrue(all(req["id"] in req_test for req in model["requirements"] if req["status"] == "current" and req["kind"] not in {"assumption", "clarification", "out-of-scope"}))
        self.assertTrue(any(item.get("kind") == "test-evidence" and item.get("content") for item in model["unclassified"]))
        self.assertFalse(any(test["title"].startswith("Transactional outbox") for test in model["test_cases"]))

    def test_tasks_do_not_become_test_results(self) -> None:
        model = build_model(FIXTURES / "tasks-no-tests")
        self.assertTrue(model["test_cases"])
        self.assertEqual({item["status"] for item in model["test_cases"]}, {"planned"})
        self.assertEqual({item["automation_status"] for item in model["test_cases"]}, {"unspecified"})

    def test_unresolved_and_checklist_block_publish_only(self) -> None:
        feature = FIXTURES / "unresolved-quality"
        draft = build_model(feature, profile="draft")
        publish = build_model(feature, profile="publish")
        self.assertTrue(draft["open_questions"])
        self.assertEqual(draft["report"]["blocking_errors"], 0)
        self.assertGreater(publish["report"]["blocking_errors"], 0)

    def test_stale_fingerprint_is_rejected(self) -> None:
        model = build_model(FIXTURES / "spec-only")
        broken = copy.deepcopy(model)
        broken["sources"][0]["sha256"] = "0" * 64
        report = evaluate_model(broken, FIXTURES / "spec-only", "publish")
        self.assertTrue(any("stale" in error for error in report["axes"]["source_integrity"]["errors"]))

    def test_evaluator_rejects_undeclared_and_zero_line_source_refs(self) -> None:
        model = build_model(FIXTURES / "spec-only")
        model["requirements"][0]["source_refs"] = ["spec.md#L0", "../spec.md#L1"]
        errors = evaluate_model(model, FIXTURES / "spec-only", "publish")["axes"]["source_integrity"]["errors"]
        self.assertTrue(any("invalid source locator" in error for error in errors))
        self.assertTrue(any("not declared" in error for error in errors))

    def test_invalid_and_duplicate_links_are_rejected(self) -> None:
        model = build_model(FIXTURES / "spec-only")
        model["links"].append(dict(model["links"][0]))
        model["links"].append({"type": "function-to-test", "from_id": "FR-001", "to_id": "NOPE"})
        report = evaluate_model(model, None, "publish")
        errors = report["axes"]["cross_artifact_consistency"]["errors"]
        self.assertTrue(any("duplicate" in error for error in errors))
        self.assertTrue(any("invalid link" in error for error in errors))

    def test_explicit_unknown_artifact_is_preserved_not_promoted(self) -> None:
        feature = FIXTURES / "unknown-extra"
        model = build_model(feature, extra_manifest=feature / "extra-artifacts.json")
        extra = next(item for item in model["unclassified"] if item["kind"] == "extra-artifact")
        self.assertIn("job ID", extra["content"])
        self.assertEqual(extra["source_ref"], "observability-notes.md#L1")
        self.assertFalse(any(item["statement"].startswith("監視基盤") for item in model["requirements"]))


class RenderTest(unittest.TestCase):
    def test_render_is_deterministic_and_self_contained(self) -> None:
        model = build_model(FIXTURES / "complete-feature")
        first = rendered_files(model, "feature")
        round_tripped = json.loads(json_text(model))
        second = rendered_files(round_tripped, "feature")
        self.assertEqual(first, second)
        html = first["feature_レビュー.html"]
        self.assertNotRegex(html, r"https?://")
        self.assertIn('role="tablist"', html)
        self.assertIn("ArrowRight", html)
        self.assertIn("@media print", html)

    def test_html_escapes_untrusted_content(self) -> None:
        model = build_model(FIXTURES / "spec-only")
        model["requirements"][0]["statement"] = "</script><img src=x onerror=alert(1)>"
        output = review_html(model)
        self.assertNotIn("<img src=x", output)
        self.assertIn("&lt;img", output)

    def test_write_rendered_writes_all_four_documents(self) -> None:
        model = build_model(FIXTURES / "spec-only")
        with tempfile.TemporaryDirectory() as temporary:
            paths = write_rendered(model, Path(temporary) / "out", "CON")
            self.assertEqual(len(paths), 4)
            self.assertTrue(all(path.is_file() for path in paths))
            self.assertTrue(safe_stem("CON").startswith("feature-"))


if __name__ == "__main__":
    unittest.main()
