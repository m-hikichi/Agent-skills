from __future__ import annotations

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
from schema_validation import require_valid_model, validate_schema, validate_source_refs
from render_documents import write_rendered


class CanonicalValidationTest(unittest.TestCase):
    def setUp(self):
        self.feature = ROOT / "evals" / "fixtures" / "spec-only"
        self.model = build_model(self.feature)

    def test_generated_fixtures_follow_schema(self):
        for feature in (ROOT / "evals" / "fixtures").iterdir():
            if (feature / "spec.md").is_file():
                with self.subTest(feature=feature.name):
                    model = build_model(feature)
                    self.assertEqual(validate_schema(model), [])
                    self.assertEqual(validate_source_refs(model, feature), [])

    def test_malformed_shapes_are_rejected_before_render(self):
        for bad in ([], None, {"schema_version": True}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                require_valid_model(bad)
        for key, value in (("requirements", [None]), ("context", []), ("mode", "bogus"), ("report", {})):
            model = copy.deepcopy(self.model)
            model[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                write_rendered(model, Path("unused-invalid-output"), "invalid")

    def test_bad_test_shapes_and_missing_required_fields(self):
        for key, value in (("status", "passed"), ("steps", "execute"), ("preconditions", "none"), ("expected_result", "")):
            model = copy.deepcopy(self.model)
            model["test_cases"][0][key] = value
            with self.subTest(key=key):
                self.assertTrue(validate_schema(model))
        del self.model["title"]
        self.assertTrue(validate_schema(self.model))

    def test_every_entity_requires_matching_active_identity_registration(self):
        from document_model import evaluate_model
        for change in ("missing", "wrong-kind", "retired", "ghost"):
            model = copy.deepcopy(self.model)
            if change == "missing":
                model["identity_registry"].pop()
            elif change == "wrong-kind":
                entry = model["identity_registry"][0]
                entry["kind"] = "function" if entry["kind"] != "function" else "requirement"
            elif change == "retired":
                model["identity_registry"][0]["lifecycle"] = "retired"
            else:
                model["identity_registry"].append({"id": "TST-999", "kind": "test-case", "lifecycle": "active", "source_key": "manual:ghost", "aliases": []})
            with self.subTest(change=change):
                self.assertTrue(evaluate_model(model)["axes"]["source_integrity"]["errors"])

    def test_source_locators_require_declared_source_and_positive_line(self):
        for reference in ("spec.md#L0", "../complete-feature/spec.md#L1", "spec.md#L999999", "spec.md", "C:/unrelated.md#L1"):
            model = copy.deepcopy(self.model)
            model["requirements"][0]["source_refs"] = [reference]
            with self.subTest(reference=reference):
                self.assertTrue(validate_source_refs(model, self.feature))

    def test_source_fingerprints_and_source_root_are_enforced(self):
        self.model["sources"][0]["sha256"] = "0" * 64
        self.assertTrue(validate_source_refs(self.model, self.feature))
        self.model["sources"][0]["path"] = "../complete-feature/spec.md"
        self.assertTrue(validate_source_refs(self.model, self.feature))

    def test_cli_reports_invalid_json_shape_without_traceback(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "invalid.json"
            path.write_text("[]", encoding="utf-8")
            for script, positional in (("render_documents.py", [str(path)]), ("check_documents.py", [str(self.feature), str(path)])):
                completed = subprocess.run([sys.executable, str(ROOT / "scripts" / script), *positional, "--output-dir", temporary], capture_output=True, text=True)
                self.assertEqual(completed.returncode, 2, completed.stderr)
                self.assertNotIn("Traceback", completed.stderr)

    def test_generate_updates_stale_input_and_preserves_existing_ids(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            feature = root / "feature"
            output = root / "output"
            shutil.copytree(self.feature, feature)
            command = [sys.executable, str(ROOT / "scripts" / "generate_documents.py"), str(feature), "--output-dir", str(output), "--name", "update"]
            first = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            canonical = output / "update_requirements-functions-tests.json"
            before = json.loads(canonical.read_text(encoding="utf-8"))
            spec = feature / "spec.md"
            spec.write_text(spec.read_text(encoding="utf-8") + "\n- FR-999: 監査記録を参照できること。\n", encoding="utf-8")
            second = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stderr)
            after = json.loads(canonical.read_text(encoding="utf-8"))
            before_ids = {entry["source_key"]: entry["id"] for entry in before["identity_registry"] if entry["lifecycle"] == "active"}
            after_ids = {entry["source_key"]: entry["id"] for entry in after["identity_registry"] if entry["lifecycle"] == "active"}
            self.assertTrue(set(before_ids).issubset(after_ids))
            self.assertTrue(all(after_ids[key] == identity for key, identity in before_ids.items()))


if __name__ == "__main__":
    unittest.main()
