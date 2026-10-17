import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from compare_documents import comparison_markdown
from document_model import build_model


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.old = build_model(ROOT / "evals/fixtures/spec-only")
        self.new = copy.deepcopy(self.old)

    def test_all_changed_fields_and_original_review_evidence_are_present(self):
        self.old["functions"][0].update(name="担当者が分割した通知受付", rationale="業務担当者とのレビューで責務を確定")
        self.old["test_cases"][0]["test_data"] = ["旧担当者が決めた@example.test"]
        self.new["test_cases"][0]["expected_result"] = "変更後の期待結果"
        self.new["requirements"][0]["statement"] = "変更後の要件"
        self.new["sources"][0]["sha256"] = "a" * 64
        question = self.old["open_questions"][0]
        question.update(status="resolved", resolution="確認担当Aが元資料と照合済み", source_refs=["spec.md#L1"])
        before = copy.deepcopy(self.old)
        markdown = comparison_markdown(self.old, self.new)
        for expected in ("担当者が分割した通知受付", "業務担当者とのレビューで責務を確定", "旧担当者が決めた@example.test", "変更後の期待結果", "変更後の要件", "a" * 64, "確認担当Aが元資料と照合済み", "そのまま引き継がれていません", "test_data", "rationale", "source_refs"):
            self.assertIn(expected, markdown)
        self.assertEqual(self.old, before)
        self.assertEqual(markdown, comparison_markdown(self.old, self.new))

    def test_added_removed_and_link_changes_are_visible(self):
        removed = self.new["test_cases"].pop()
        added = copy.deepcopy(removed)
        added["id"] = "TST-999"
        self.new["test_cases"].append(added)
        link = self.new["links"].pop()
        self.new["links"].append(dict(type="requirement-to-test", from_id=self.new["requirements"][0]["id"], to_id="TST-999"))
        markdown = comparison_markdown(self.old, self.new)
        self.assertIn('"TST-999" — 追加', markdown)
        self.assertIn('"' + removed["id"] + '" — 削除・引継ぎ確認', markdown)
        self.assertIn(link["from_id"], markdown)
        self.assertIn("## 関連付けの変更", markdown)

    def run_cli(self, old, new, output):
        return subprocess.run([sys.executable, str(ROOT / "scripts/compare_documents.py"), str(old), str(new), "--output", str(output)], capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"})

    def test_cli_preserves_both_inputs_and_refuses_existing_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            old, new, report = directory / "old.json", directory / "new.json", directory / "comparison.md"
            old.write_text(json.dumps(self.old, ensure_ascii=False), encoding="utf-8")
            new.write_text(json.dumps(self.new, ensure_ascii=False), encoding="utf-8")
            original = old.read_bytes(), new.read_bytes()
            result = self.run_cli(old, new, report)
            self.assertEqual(result.returncode, 0, result.stderr)
            report_bytes = report.read_bytes()
            self.assertEqual(self.run_cli(old, new, report).returncode, 2)
            self.assertEqual(self.run_cli(old, new, old).returncode, 2)
            self.assertEqual((old.read_bytes(), new.read_bytes()), original)
            self.assertEqual(report.read_bytes(), report_bytes)

    def test_schema_invalid_input_does_not_create_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            old, new, report = directory / "old.json", directory / "new.json", directory / "comparison.md"
            old.write_text("[]", encoding="utf-8")
            new.write_text(json.dumps(self.new), encoding="utf-8")
            self.assertEqual(self.run_cli(old, new, report).returncode, 2)
            self.assertFalse(report.exists())


if __name__ == "__main__":
    unittest.main()
