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
    parser.add_argument(
        "--skip-audit-check",
        action="store_true",
        help="Skip final audit section check (for SubagentStop)",
    )
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


def summarize_output(output: str, max_lines: int = 10, max_chars: int = 600) -> str:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines:
        return "出力なし"
    summary = "\n".join(lines[:max_lines])
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


def run_consistency_check(project_root: Path, plugin_root: Path, runner: str = "docker") -> CommandResult:
    if runner != "docker":
        return CommandResult(
            ok=False,
            summary="reviewer NG: `verification.consistency_runner` は `docker` のみサポートしています。",
        )
    # review_stop_gate.py itself runs inside Docker (launched by run_verify_stop_hook.sh).
    # So we can call verify_spec_consistency.py directly without Docker-in-Docker.
    script = plugin_root / "scripts" / "verify_spec_consistency.py"
    command = [sys.executable, str(script), "--project-root", str(project_root)]
    return run_subprocess(command, cwd=project_root)


def run_project_test_commands(project_root: Path, commands: Sequence[str]) -> CommandResult:
    # project_test_commands are now executed by run_verify_stop_hook.sh on the host
    # (they typically use docker compose and need host Docker access).
    # This function is kept for backward compatibility with tests.
    for command in commands:
        runner = ["/bin/sh", "-lc", command]
        result = run_subprocess(runner, cwd=project_root)
        if not result.ok:
            result.summary = f"`{command}` failed:\n{result.summary}"
            return result
    return CommandResult(ok=True, summary="すべての project_test_commands が成功")


def block(reason: str) -> ReviewVerdict:
    return ReviewVerdict(allow_stop=False, reason=reason)


def _run_consistency_gate(
    *,
    project_root: Path,
    plugin_root: Path,
    config: Dict[str, Any],
    config_path: Path,
    run_consistency: Callable[..., CommandResult],
) -> ReviewVerdict | None:
    """Run consistency check. Returns a block verdict on failure, None on success."""
    verification = config.get("verification")
    if not isinstance(verification, dict):
        return block("reviewer NG: spec-config.json に verification セクションがありません。")

    consistency_runner = verification.get("consistency_runner")
    if consistency_runner != "docker":
        return block(
            "reviewer NG: `verification.consistency_runner` を `docker` にしてください。"
            " ローカル環境での実行はサポートしていません。"
        )

    consistency = run_consistency(project_root, plugin_root, consistency_runner)
    if not consistency.ok:
        return block(
            "reviewer NG: `verify_spec_consistency.py` が失敗しました。\n"
            f"Findings:\n{consistency.summary}"
        )
    return None


def review_stop_request(
    *,
    hook_input: Dict[str, Any],
    project_root: Path,
    config: Dict[str, Any] | None,
    config_path: Path,
    plugin_root: Path,
    run_consistency: Callable[..., CommandResult] = run_consistency_check,
    run_project_tests: Callable[[Path, Sequence[str]], CommandResult] = run_project_test_commands,
    skip_audit_check: bool = False,
) -> ReviewVerdict:
    # --- skip-audit-check モード（SubagentStop 用） ---
    # 最終整合性監査セクションの書式チェックをスキップし、整合性チェックのみ実行する。
    # サブエージェントは最終整合性監査を書く責務がないため。
    if skip_audit_check:
        if config is None:
            return block(f"reviewer NG: spec-config.json が見つかりません: {config_path}")

        consistency_block = _run_consistency_gate(
            project_root=project_root,
            plugin_root=plugin_root,
            config=config,
            config_path=config_path,
            run_consistency=run_consistency,
        )
        if consistency_block is not None:
            return consistency_block

        return ReviewVerdict(allow_stop=True)

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

    # --- needs-user-decision: 整合性チェックは必須、テスト実行はスキップ ---
    if audit.status == "needs-user-decision":
        if not audit.remaining or audit.remaining == "なし":
            return block(
                "reviewer NG: `判定: needs-user-decision` のときは、"
                " `残件:` に人間の判断が必要な内容を書いてください。"
            )

        if config is None:
            return block(f"reviewer NG: spec-config.json が見つかりません: {config_path}")

        consistency_block = _run_consistency_gate(
            project_root=project_root,
            plugin_root=plugin_root,
            config=config,
            config_path=config_path,
            run_consistency=run_consistency,
        )
        if consistency_block is not None:
            return block(
                f"{consistency_block.reason}\n"
                "※ `判定: needs-user-decision` でも整合性チェックは必須です。"
            )

        return ReviewVerdict(allow_stop=True)

    # --- clean: 整合性チェック + テスト実行の両方が必須 ---
    if config is None:
        return block(f"reviewer NG: spec-config.json が見つかりません: {config_path}")

    consistency_block = _run_consistency_gate(
        project_root=project_root,
        plugin_root=plugin_root,
        config=config,
        config_path=config_path,
        run_consistency=run_consistency,
    )
    if consistency_block is not None:
        return consistency_block

    # project_test_commands are executed by run_verify_stop_hook.sh on the host
    # (they need host Docker access for docker compose commands).
    # review_stop_gate.py only handles consistency check + audit format.

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
        plugin_root = Path(__file__).resolve().parent.parent

        verdict = review_stop_request(
            hook_input=hook_input,
            project_root=project_root,
            config=config,
            config_path=config_path,
            plugin_root=plugin_root,
            skip_audit_check=args.skip_audit_check,
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
