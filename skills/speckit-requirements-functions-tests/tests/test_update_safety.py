"""Editorial work must survive repeat generation and source updates."""
import copy
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from document_model import build_model
from update_safety import UpdateConflict


class UpdateSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.feature = self.root / "feature"
        shutil.copytree(ROOT / "evals/fixtures/spec-only", self.feature)

    def change_source(self):
        spec = self.feature / "spec.md"
        spec.write_text(spec.read_text(encoding="utf-8") + "\n- FR-999: 監査記録を参照できる。\n", encoding="utf-8")

    def test_unchanged_input_preserves_arbitrary_editorial_changes_and_questions(self):
        model = build_model(self.feature)
        model["functions"][0]["name"] = "確認済みの業務機能"
        model["test_cases"][0]["test_data"] = ["qa@example.test"]
        model["open_questions"][-1].update(status="resolved", resolution="根拠に照らし確認済み")
        model["links"] = list(reversed(model["links"]))
        before = copy.deepcopy(model)
        after = build_model(self.feature, existing=model)
        for key in model:
            if key != "report":
                self.assertEqual(after[key], before[key], key)
        self.assertEqual(model, before, "caller object must not mutate")

    def test_changed_input_with_reviewed_work_blocks_unless_separate_proposal(self):
        model = build_model(self.feature)
        model["test_cases"][0]["steps"] = ["レビューで具体化した操作"]
        self.change_source()
        with self.assertRaises(UpdateConflict):
            build_model(self.feature, existing=model)
        proposal = build_model(self.feature, existing=model, update_proposal=True)
        self.assertTrue(any(q["return_to"] == "update-review" and q["status"] == "open" for q in proposal["open_questions"]))
        self.assertIn("FR-999", {r["id"] for r in proposal["requirements"]})

    def test_legacy_without_digest_is_preserved_and_never_assumed_unedited(self):
        model = build_model(self.feature)
        del model["generation_digest"]
        same = build_model(self.feature, existing=model)
        self.assertEqual(same["functions"], model["functions"])
        self.change_source()
        with self.assertRaises(UpdateConflict):
            build_model(self.feature, existing=model)

    def test_plain_draft_can_update_and_records_same_id_modification(self):
        model = build_model(self.feature)
        spec = self.feature / "spec.md"
        content = spec.read_text(encoding="utf-8")
        lines = content.splitlines()
        index = next(i for i, line in enumerate(lines) if "FR-001" in line)
        lines[index] += " 確認画面を表示する。"
        spec.write_text("\n".join(lines) + "\n", encoding="utf-8")
        updated = build_model(self.feature, existing=model)
        self.assertTrue(any(x["id"] == "FR-001" and x["change"] == "modified" for x in updated["change_impact"]))

    def test_cli_conflict_and_proposal_leave_all_original_files_byte_identical(self):
        output = self.root / "out"
        command = [sys.executable, "-X", "utf8", str(ROOT / "scripts/generate_documents.py"), str(self.feature), "--output-dir", str(output), "--name", "reviewed"]
        def run(*extra):
            return subprocess.run([*command, *extra], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(run().returncode, 0)
        canonical = output / "reviewed_requirements-functions-tests.json"
        model = json.loads(canonical.read_text(encoding="utf-8"))
        model["functions"][0]["name"] = "レビュー済み"
        canonical.write_text(json.dumps(model, ensure_ascii=False), encoding="utf-8")
        original = {p.name: p.read_bytes() for p in output.iterdir()}
        self.change_source()
        blocked = run()
        self.assertEqual(blocked.returncode, 1, blocked.stderr)
        proposed = run("--update-proposal")
        self.assertEqual(proposed.returncode, 0, proposed.stderr)
        for name, contents in original.items():
            self.assertEqual((output / name).read_bytes(), contents)
        proposal = output / "reviewed_update-proposal_requirements-functions-tests.json"
        contents = proposal.read_bytes()
        self.assertEqual(run("--update-proposal").returncode, 2)
        self.assertEqual(proposal.read_bytes(), contents)

    def test_long_and_proposal_shaped_names_never_overwrite_original_projections(self):
        for stem in ("a" * 120, "a" * 100 + "_update-proposal"):
            with self.subTest(stem=stem):
                output = self.root / stem[:40]
                command = [sys.executable, "-X", "utf8", str(ROOT / "scripts/generate_documents.py"), str(self.feature), "--output-dir", str(output), "--name", stem]
                first = subprocess.run(command, capture_output=True)
                self.assertEqual(first.returncode, 0, first.stderr)
                original = {p.name: p.read_bytes() for p in output.iterdir()}
                proposal = subprocess.run([*command, "--update-proposal"], capture_output=True)
                self.assertEqual(proposal.returncode, 0, proposal.stderr)
                for name, content in original.items():
                    self.assertEqual((output / name).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
