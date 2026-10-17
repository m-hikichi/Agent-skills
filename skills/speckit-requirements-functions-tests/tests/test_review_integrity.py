"""Review completion must refer to the exact version that was reviewed."""
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
from render_documents import function_review_status, test_readiness, rendered_files
from review_integrity import attest_review, review_digest, review_issue


class ReviewIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.feature = ROOT / "evals/fixtures/spec-only"
        self.model = build_model(self.feature)
        for fn in self.model["functions"]:
            fn["basis"] = "confirmed"
        for case in self.model["test_cases"]:
            case.update(preconditions=["通知先一覧が空でログイン済み"], steps=["通知先欄にqa@example.testを入力して登録する"],
                        test_data=["通知先: qa@example.test"], expected_result="通知先一覧にqa@example.testが1件表示される")
        for question in self.model["open_questions"]:
            question.update(status="resolved", resolution="合成モデルの機械検査用の解決記録")

    def attest(self, model=None):
        model = self.model if model is None else model
        attest_review(model, expected_digest=review_digest(model), reviewer="test-reviewer", summary="Synthetic test attestation")

    def test_legacy_resolved_questions_do_not_count_as_versioned_review(self):
        self.assertEqual(review_issue(self.model), "review attestation is missing")
        self.assertEqual(evaluate_model(self.model, profile="publish")["status"], "blocked")
        self.assertEqual(evaluate_model(self.model, profile="draft")["blocking_errors"], 0)

    def test_every_editorial_change_invalidates_review_and_ready_labels(self):
        self.attest()
        self.assertEqual(evaluate_model(self.model, profile="publish")["status"], "publishable")
        mutations = {
            "test": lambda m: m["test_cases"][0].update(expected_result="別の期待結果"),
            "function": lambda m: m["functions"][0].update(name="別の機能"),
            "requirement": lambda m: m["requirements"][0].update(statement="別の要求"),
            "links": lambda m: m["links"].pop(),
            "source": lambda m: m["sources"][0].update(sha256="0" * 64),
            "question": lambda m: m["open_questions"][0].update(resolution="判断を変更"),
            "context": lambda m: m["context"].update(overview="目的を変更"),
        }
        for label, mutate in mutations.items():
            model = copy.deepcopy(self.model)
            mutate(model)
            with self.subTest(label=label):
                self.assertIn("stale", review_issue(model))
                self.assertEqual(evaluate_model(model, profile="publish")["status"], "blocked")
                self.assertNotEqual(test_readiness(model["test_cases"][0], model)[0], "実施可能")
                self.assertNotEqual(function_review_status(model, model["functions"][0]["id"]), "確認済み")
        html = rendered_files(model, "sample")["sample_レビュー.html"]
        self.assertIn("レビュー後に資料の内容が変更されています", html)

    def test_report_profile_and_serialization_do_not_invalidate_review(self):
        self.attest()
        digest = review_digest(self.model)
        self.model["profile"] = "publish"
        self.model["report"] = evaluate_model(self.model, profile="publish")
        self.model["generation_digest"] = "0" * 64
        roundtrip = json.loads(json.dumps(self.model, sort_keys=True))
        self.assertEqual(review_digest(roundtrip), digest)
        self.assertIsNone(review_issue(roundtrip))

    def test_attestation_cannot_use_digest_from_before_last_edit(self):
        digest = review_digest(self.model)
        self.model["test_cases"][0]["test_data"].append("宛先: changed@example.test")
        with self.assertRaisesRegex(ValueError, "content has changed"):
            attest_review(self.model, expected_digest=digest, reviewer="test", summary="reviewed")
        self.assertNotIn("review_record", self.model)

    def test_record_cli_refuses_unresolved_work_and_stale_version_without_writing(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "canonical.json"
            def run(model, digest=None):
                path.write_text(json.dumps(model), encoding="utf-8")
                before = path.read_bytes()
                result = subprocess.run([sys.executable, "-X", "utf8", str(ROOT / "scripts/review_documents.py"), "record", str(path),
                    "--feature-dir", str(self.feature), "--expected-digest", digest or review_digest(model),
                    "--reviewer", "test-reviewer", "--summary", "Synthetic test"], capture_output=True)
                return result, before
            unresolved = build_model(self.feature)
            result, original = run(unresolved)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(path.read_bytes(), original)
            result, original = run(self.model, "0" * 64)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertEqual(path.read_bytes(), original)
            result, _ = run(self.model)
            self.assertEqual(result.returncode, 0, result.stderr)
            recorded = json.loads(path.read_text(encoding="utf-8"))
            self.assertIsNone(review_issue(recorded))
            self.assertEqual(recorded["functions"], self.model["functions"])


if __name__ == "__main__":
    unittest.main()
