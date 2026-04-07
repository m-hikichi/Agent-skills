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


def ok_consistency(project_root: Path, plugin_root: Path, runner: str = "docker"):
    return MODULE.CommandResult(ok=True, summary="verify passed")


def fail_consistency(project_root: Path, plugin_root: Path, runner: str = "docker"):
    return MODULE.CommandResult(ok=False, summary="- High: SPEC-001 / FR-001 implementation file not found")


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
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("最終整合性監査", verdict.reason)

    def test_review_allows_clean_when_all_checks_pass(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertTrue(verdict.allow_stop)
        self.assertIsNone(verdict.reason)

    def test_review_allows_needs_user_decision_when_consistency_passes(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(status="needs-user-decision", remaining="入力仕様の優先順位をユーザーに確認する"),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertTrue(verdict.allow_stop)

    def test_review_blocks_needs_user_decision_when_consistency_fails(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(status="needs-user-decision", remaining="入力仕様の優先順位をユーザーに確認する"),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=fail_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("verify_spec_consistency.py", verdict.reason)
        self.assertIn("整合性チェックは必須", verdict.reason)

    def test_review_blocks_when_consistency_runner_is_not_docker(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "local", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("docker", verdict.reason)

    def test_block_reason_includes_findings_detail(self) -> None:
        verdict = MODULE.review_stop_request(
            hook_input=self.make_hook_input(),
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=fail_consistency,
            run_project_tests=ok_tests,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("SPEC-001", verdict.reason)
        self.assertIn("FR-001", verdict.reason)

    # --- skip_audit_check tests (SubagentStop) ---

    def test_skip_audit_check_allows_stop_without_audit_section(self) -> None:
        """SubagentStop: 最終整合性監査セクションなしでも整合性チェックが通れば停止できる"""
        verdict = MODULE.review_stop_request(
            hook_input={"last_assistant_message": "監査完了。findings なし。"},
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
            skip_audit_check=True,
        )
        self.assertTrue(verdict.allow_stop)

    def test_skip_audit_check_blocks_on_consistency_failure(self) -> None:
        """SubagentStop: 整合性チェック失敗時はブロックする"""
        verdict = MODULE.review_stop_request(
            hook_input={"last_assistant_message": "作業完了。"},
            project_root=Path("."),
            config={"verification": {"consistency_runner": "docker", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=fail_consistency,
            run_project_tests=ok_tests,
            skip_audit_check=True,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("verify_spec_consistency.py", verdict.reason)

    def test_skip_audit_check_blocks_when_config_missing(self) -> None:
        """SubagentStop: spec-config.json がない場合はブロックする"""
        verdict = MODULE.review_stop_request(
            hook_input={"last_assistant_message": "完了。"},
            project_root=Path("."),
            config=None,
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
            skip_audit_check=True,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("spec-config.json", verdict.reason)

    def test_skip_audit_check_blocks_when_runner_not_docker(self) -> None:
        """SubagentStop: consistency_runner が docker でない場合はブロックする"""
        verdict = MODULE.review_stop_request(
            hook_input={"last_assistant_message": "完了。"},
            project_root=Path("."),
            config={"verification": {"consistency_runner": "local", "project_test_commands": ["echo ok"]}},
            config_path=Path("spec-config.json"),
            plugin_root=Path("."),
            run_consistency=ok_consistency,
            run_project_tests=ok_tests,
            skip_audit_check=True,
        )
        self.assertFalse(verdict.allow_stop)
        self.assertIn("docker", verdict.reason)


if __name__ == "__main__":
    unittest.main()
