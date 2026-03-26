import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "review_stop_gate.py"
SPEC = importlib.util.spec_from_file_location("review_stop_gate", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def ok_consistency(project_root: Path, skill_dir: Path):
    return MODULE.CommandResult(ok=True, summary="verify passed")


def ok_tests(project_root: Path, commands):
    return MODULE.CommandResult(ok=True, summary="tests passed")


class ReviewStopGateTests(unittest.TestCase):
    def make_hook_input(self, status: str = "clean", remaining: str = "なし") -> dict:
        return {
            "last_assistant_message": f"""
## 変更内容

- sample

## 最終整合性監査

- 判定: {status}
- 監査対象: requirements.md, SPEC-001
- 実行した検証:
  - verify
  - tests
- 残件: {remaining}
""".strip()
        }

    def test_parse_final_audit_detects_clean_status(self) -> None:
        audit = MODULE.parse_final_audit(self.make_hook_input()["last_assistant_message"])
        self.assertTrue(audit.present)
        self.assertEqual(audit.status, "clean")
        self.assertEqual(audit.remaining, "なし")

    def test_review_blocks_when_final_audit_is_missing(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input={"last_assistant_message": "作業完了です。"},
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            skill_dir=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("最終整合性監査", verdict.reason)

    def test_review_blocks_when_project_test_commands_are_missing(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": []}},
            config_path=Path("spec-config.json"),
            skill_dir=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("project_test_commands", verdict.reason)

    def test_review_allows_clean_when_all_checks_pass(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            skill_dir=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertTrue(verdict.allow_stop)
        self.assertIsNone(verdict.reason)

    def test_review_allows_needs_user_decision_pause(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(status="needs-user-decision", remaining="入力仕様の優先順位をユーザーに確認する"),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            skill_dir=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertTrue(verdict.allow_stop)

    def test_review_blocks_when_consistency_runner_is_not_docker(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "python", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            skill_dir=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("consistency_runner", verdict.reason)


if __name__ == "__main__":
    unittest.main()
