from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from document_model import build_model, evaluate_model
from render_documents import test_readiness, rendered_files, function_review_status, write_rendered
from test_quality import missing_test_fields
from review_integrity import attest_review, review_digest


class QualityGateTests(unittest.TestCase):
    def setUp(self):
        self.model = build_model(ROOT / "evals" / "fixtures" / "spec-only")
        self.model["open_questions"] = [{"id": "Q-001", "return_to": "semantic-review", "status": "resolved", "resolution": "原文との対応を独立レビュー済み", "source_refs": ["spec.md#L1"]}]
        for function in self.model["functions"]:
            function["basis"] = "confirmed"
        for test in self.model["test_cases"]:
            test.update(preconditions=["検証用環境が起動している"], steps=["通知先を登録する"],
                        test_data=["宛先: sample@example.test"], expected_result="登録した宛先が一覧に表示される")
        attest_review(self.model, expected_digest=review_digest(self.model), reviewer="unit-test", summary="Synthetic model for gate tests, not business approval")

    def test_readiness_and_publish_use_the_same_fields(self):
        self.assertEqual(evaluate_model(self.model, profile="publish")["status"], "publishable")
        for field in ("preconditions", "steps", "expected_result", "test_data"):
            for value in ("unspecified", "TBD", "要確認", "", "N/A"):
                model = copy.deepcopy(self.model)
                test = model["test_cases"][0]
                test[field] = value if field == "expected_result" else [value]
                with self.subTest(field=field, value=value):
                    self.assertIn(field, missing_test_fields(test))
                    self.assertEqual(test_readiness(test)[0], "要具体化")
                    self.assertEqual(evaluate_model(model, profile="publish")["status"], "blocked")
                    self.assertTrue(evaluate_model(model, profile="draft")["axes"]["test_coverage"]["warnings"])

    def test_mixed_placeholder_steps_are_incomplete(self):
        test = self.model["test_cases"][0]
        test["steps"].append("unspecified")
        self.assertIn("steps", missing_test_fields(test))

    def test_reasoned_non_applicability_and_invalid_input_are_supported(self):
        test = self.model["test_cases"][0]
        test.update(preconditions=["該当なし: 静的な文書の目視確認のため"],
                    test_data=["Not applicable: inspection does not submit input"],
                    steps=["Inspect the documented invalid input handling"])
        self.assertEqual(missing_test_fields(test), [])
        self.assertEqual(test_readiness(test)[0], "実施可能")

    def test_cross_function_integration_uses_union_not_intersection(self):
        model = self.model
        old_fn = model["functions"][0]["id"]
        new_fn = copy.deepcopy(model["functions"][0])
        new_fn["id"] = "FNC-999"
        model["functions"].append(new_fn)
        test_id = model["test_cases"][0]["id"]
        req_ids = [r["id"] for r in model["requirements"] if r["status"] == "current"][:2]
        model["links"] = [link for link in model["links"] if not (
            link["type"] == "requirement-to-function" and link["from_id"] == req_ids[1])]
        model["links"].append(dict(type="requirement-to-function", from_id=req_ids[1], to_id=new_fn["id"]))
        # Existing tests of the moved requirement follow its new function.
        for link in model["links"]:
            if link["type"] == "requirement-to-test" and link["from_id"] == req_ids[1]:
                for target in model["links"]:
                    if target["type"] == "function-to-test" and target["to_id"] == link["to_id"]:
                        target["from_id"] = new_fn["id"]
        model["links"] = [link for link in model["links"] if not (link["to_id"] == test_id and link["type"] in {"requirement-to-test", "function-to-test"})]
        model["links"].extend(dict(type="requirement-to-test", from_id=req_id, to_id=test_id) for req_id in req_ids)
        model["links"].extend(dict(type="function-to-test", from_id=fn_id, to_id=test_id) for fn_id in (old_fn, new_fn["id"]))
        self.assertEqual(evaluate_model(model)["axes"]["cross_artifact_consistency"]["errors"], [])
        model["links"] = [link for link in model["links"] if not (link["type"] == "requirement-to-test" and link["to_id"] == test_id and link["from_id"] == req_ids[1])]
        self.assertTrue(evaluate_model(model)["axes"]["cross_artifact_consistency"]["errors"])

    def test_each_test_requires_a_direct_requirement(self):
        test_id = self.model["test_cases"][0]["id"]
        self.model["links"] = [link for link in self.model["links"] if not (link["type"] == "requirement-to-test" and link["to_id"] == test_id)]
        errors = evaluate_model(self.model)["axes"]["test_coverage"]["errors"]
        self.assertIn(f"{test_id}: no direct requirement link", errors)

    def test_publish_requires_review_record_and_resolution_evidence(self):
        for field in ("resolution", "source_refs"):
            model = copy.deepcopy(self.model)
            del model["open_questions"][0][field]
            self.assertEqual(evaluate_model(model, profile="publish")["status"], "blocked")
        self.model["open_questions"] = []
        self.assertEqual(evaluate_model(self.model, profile="publish")["status"], "blocked")

    def test_renaming_a_derived_function_does_not_bypass_boundary_review(self):
        self.model["functions"][0].update(name="名称を変えただけの機能候補", basis="derived")
        self.assertTrue(evaluate_model(self.model, profile="publish")["axes"]["function_coverage"]["errors"])

    def test_future_or_retired_function_cannot_cover_current_requirement(self):
        for status in ("future", "retired"):
            model = copy.deepcopy(self.model)
            model["functions"][0]["status"] = status
            report = evaluate_model(model, profile="publish")
            self.assertTrue(report["axes"]["function_coverage"]["errors"])
            self.assertTrue(report["axes"]["test_coverage"]["errors"])

    def test_current_function_requires_current_normative_requirement(self):
        for req in self.model["requirements"]:
            req["status"] = "out-of-scope"
        errors = evaluate_model(self.model)["axes"]["function_coverage"]["errors"]
        self.assertTrue(any("current function has no current requirement" in error for error in errors))

    def test_render_ignores_stale_report_without_mutating_canonical(self):
        model = self.model
        model["report"] = evaluate_model(model, profile="draft")
        test = model["test_cases"][0]
        test["test_data"] = []
        before = copy.deepcopy(model)
        html = rendered_files(model, "review", ROOT / "evals/fixtures/spec-only")["review_レビュー.html"]
        self.assertIn(test["id"] + ": テストデータを具体化してください。", html)
        self.assertEqual(model, before)

    def test_related_question_and_invalid_review_evidence_block_ready_labels(self):
        test = self.model["test_cases"][0]
        self.assertEqual(test_readiness(test, self.model)[0], "実施可能")
        self.model["open_questions"].append({"id": "Q-002", "status": "open", "return_to": "speckit.clarify", "affected_ids": [test["id"]]})
        self.assertEqual(test_readiness(test, self.model)[0], "内容レビュー待ち")
        self.model["open_questions"] = self.model["open_questions"][:1]
        self.model["open_questions"][0]["resolution"] = ""
        self.assertEqual(test_readiness(test, self.model)[0], "内容レビュー待ち")
        self.assertNotEqual(function_review_status(self.model, self.model["functions"][0]["id"]), "確認済み")

    def test_render_then_check_accepts_editorial_changes_with_stale_cached_report(self):
        feature = ROOT / "evals/fixtures/spec-only"
        model = build_model(feature)
        model["test_cases"][0].update(steps=["更新した確認操作"], preconditions=["環境が起動している"], test_data=["確認用 fixture A"], expected_result="確認結果が表示される")
        self.assertNotEqual(model["report"], evaluate_model(model, feature, model["profile"]))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            canonical = output / "review_requirements-functions-tests.json"
            canonical.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
            original_bytes = canonical.read_bytes()
            write_rendered(model, output, "review", feature)
            result = subprocess.run([sys.executable, str(ROOT / "scripts/check_documents.py"), str(feature), str(canonical), "--output-dir", str(output), "--profile", "draft"], capture_output=True, text=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(canonical.read_bytes(), original_bytes)


if __name__ == "__main__":
    unittest.main()
