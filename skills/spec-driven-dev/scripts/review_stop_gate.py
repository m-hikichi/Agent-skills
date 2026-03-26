#!/usr/bin/env python3
"""Review whether Claude may stop while using spec-driven-dev."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Sequence


FINAL_AUDIT_HEADING = "最終整合性監査"
FINAL_AUDIT_STATUS_RE = re.compile(r"判定\s*:\s*(clean|needs-user-decision)\b")
FINAL_AUDIT_REMAINING_RE = re.compile(r"残件\s*:\s*(.+)")


@dataclass
class CommandResult:
    ok: bool
    summary: str
    output: str = ""


@dataclass
class FinalAuditStatus:
    present: bool
    status: str | None = None
    section: str = ""
    remaining: str | None = None


@dataclass
class ReviewVerdict:
    allow_stop: bool
    reason: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=None, help="Project root directory")
    parser.add_argument("--config", default="spec-config.json", help="Path to spec-config.json")
    parser.add_argument("--hook-input", default=None, help="Hook input JSON for testing")
    return parser.parse_args()


def load_hook_input(raw: str) -> Dict[str, Any]:
    text = raw.strip()
    if not text:
        return {}
    return json.loads(text)


def resolve_project_root(cli_value: str | None, hook_input: Dict[str, Any]) -> Path:
    candidate = cli_value or hook_input.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or "."
    return Path(str(candidate)).resolve()


def load_config(project_root: Path, config_path: str) -> tuple[Dict[str, Any] | None, Path]:
    path = (project_root / config_path).resolve()
    if not path.exists():
        return None, path
    return json.loads(path.read_text(encoding="utf-8")), path


def extract_markdown_section(markdown: str, heading: str) -> str:
    lines = markdown.splitlines()
    start: int | None = None
    pattern = re.compile(rf"^##\s+{re.escape(heading)}\s*$")

    for index, line in enumerate(lines):
        if pattern.match(line.strip()):
            start = index + 1
            break

    if start is None:
        return ""

    collected: list[str] = []
    for line in lines[start:]:
        if re.match(r"^##\s+", line.strip()):
            break
        collected.append(line)
    return "\n".join(collected).strip()


def parse_final_audit(message: str) -> FinalAuditStatus:
    section = extract_markdown_section(message, FINAL_AUDIT_HEADING)
    if not section:
        return FinalAuditStatus(present=False)

    status_match = FINAL_AUDIT_STATUS_RE.search(section)
    remaining_match = FINAL_AUDIT_REMAINING_RE.search(section)
    return FinalAuditStatus(
        present=True,
        status=status_match.group(1) if status_match else None,
        section=section,
        remaining=remaining_match.group(1).strip() if remaining_match else None,
    )


def summarize_output(output: str, max_lines: int = 3, max_chars: int = 280) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines:
        return "出力なし"
    summary = " / ".join(lines[:max_lines])
    if len(summary) > max_chars:
        return summary[: max_chars - 3] + "..."
    return summary


def run_subprocess(command: Sequence[str], cwd: Path) -> CommandResult:
    result = subprocess.run(
        list(command),
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )
    output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part).strip()
    return CommandResult(
        ok=result.returncode == 0,
        summary=summarize_output(output),
        output=output,
    )


def run_consistency_check(project_root: Path, skill_dir: Path) -> CommandResult:
    if os.name == "nt":
        command = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(skill_dir / "scripts" / "run_verify_in_docker.ps1"),
            "-ProjectRoot",
            str(project_root),
        ]
    else:
        command = [
            "sh",
            str(skill_dir / "scripts" / "run_verify_in_docker.sh"),
            str(project_root),
        ]
    return run_subprocess(command, cwd=project_root)


def run_project_test_commands(project_root: Path, commands: Sequence[str]) -> CommandResult:
    for command in commands:
        if os.name == "nt":
            runner = [
                "powershell.exe",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                command,
            ]
        else:
            runner = ["/bin/sh", "-lc", command]

        result = run_subprocess(runner, cwd=project_root)
        if not result.ok:
            result.summary = f"`{command}` failed: {result.summary}"
            return result
    return CommandResult(ok=True, summary="すべての project_test_commands が成功")


def block(reason: str) -> ReviewVerdict:
    return ReviewVerdict(allow_stop=False, reason=reason)


def review_stop_request(
    *,
    hook_input: Dict[str, Any],
    project_root: Path,
    config: Dict[str, Any] | None,
    config_path: Path,
    skill_dir: Path,
    run_consistency: Callable[[Path, Path], CommandResult] = run_consistency_check,
    run_project_tests: Callable[[Path, Sequence[str]], CommandResult] = run_project_test_commands,
) -> ReviewVerdict:
    audit = parse_final_audit(str(hook_input.get("last_assistant_message", "")))

    if not audit.present:
        return block(
            "reviewer NG: 最終メッセージに `## 最終整合性監査` セクションがありません。"
            " `判定: clean` または `判定: needs-user-decision` を明記してください。"
        )

    if audit.status is None:
        return block(
            "reviewer NG: `最終整合性監査` に `判定: clean` または "
            "`判定: needs-user-decision` がありません。"
        )

    if audit.status == "needs-user-decision":
        if not audit.remaining or audit.remaining == "なし":
            return block(
                "reviewer NG: `判定: needs-user-decision` のときは、"
                " `残件:` に人間の判断が必要な内容を書いてください。"
            )
        return ReviewVerdict(allow_stop=True)

    if config is None:
        return block(f"reviewer NG: spec-config.json が見つかりません: {config_path}")

    verification = config.get("verification")
    if not isinstance(verification, dict):
        return block("reviewer NG: spec-config.json に verification セクションがありません。")

    consistency_runner = verification.get("consistency_runner")
    if consistency_runner != "docker":
        return block(
            "reviewer NG: Claude Code で完了ブロックする運用では "
            "`verification.consistency_runner` を `docker` にしてください。"
        )

    project_test_commands = verification.get("project_test_commands")
    if not isinstance(project_test_commands, list):
        return block("reviewer NG: `verification.project_test_commands` は配列で定義してください。")

    commands = [str(command).strip() for command in project_test_commands if str(command).strip()]
    if not commands:
        return block(
            "reviewer NG: `verification.project_test_commands` が空です。"
            " プロジェクト固有テストを 1 件以上設定してください。"
        )

    consistency = run_consistency(project_root, skill_dir)
    if not consistency.ok:
        return block(
            "reviewer NG: `verify_spec_consistency.py` が失敗しました。"
            f" {consistency.summary}"
        )

    tests = run_project_tests(project_root, commands)
    if not tests.ok:
        return block(f"reviewer NG: `project_test_commands` が失敗しました。 {tests.summary}")

    return ReviewVerdict(allow_stop=True)


def emit_block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def main() -> int:
    args = parse_args()
    raw_hook_input = args.hook_input if args.hook_input is not None else sys.stdin.read()

    try:
        hook_input = load_hook_input(raw_hook_input)
        project_root = resolve_project_root(args.project_root, hook_input)
        config, config_path = load_config(project_root, args.config)
        skill_dir = Path(__file__).resolve().parent.parent

        verdict = review_stop_request(
            hook_input=hook_input,
            project_root=project_root,
            config=config,
            config_path=config_path,
            skill_dir=skill_dir,
        )
        if verdict.allow_stop:
            return 0

        emit_block(verdict.reason or "reviewer NG")
        return 0
    except Exception as exc:  # pragma: no cover - defensive hook behavior
        emit_block(f"reviewer NG: stop hook reviewer で予期しない失敗が起きました: {exc}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
