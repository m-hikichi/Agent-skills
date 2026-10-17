#!/usr/bin/env python3
"""Generate the canonical model and all review documents from a Spec Kit feature."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from document_model import build_model, json_text
from render_documents import safe_stem, write_rendered
from schema_validation import require_valid_model
from update_safety import UpdateConflict


def feature_path(value: Path) -> Path:
    path = value.resolve()
    if path.is_file():
        if path.name.casefold() != "spec.md":
            raise ValueError("a file input must be named spec.md")
        return path.parent
    if not path.is_dir():
        raise ValueError(f"feature path does not exist: {value}")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Spec Kit v1.0.x成果物から要件・機能・テスト文書一式を生成")
    parser.add_argument("feature_or_spec", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--mode", choices=("auto", "spec-only", "plan-enriched"), default="auto")
    parser.add_argument("--profile", choices=("draft", "publish"), default="draft")
    parser.add_argument("--extra-artifacts", type=Path)
    parser.add_argument("--name", help="出力ファイル名の接頭辞。省略時はfeatureディレクトリ名")
    parser.add_argument("--update-proposal", action="store_true", help="既存資料を保持し、別名の更新案を生成する（要比較レビュー）")
    args = parser.parse_args()
    try:
        feature_dir = feature_path(args.feature_or_spec)
        output_dir = args.output_dir.resolve()
        stem = safe_stem(args.name or feature_dir.name)
        canonical_name = f"{stem}_requirements-functions-tests.json"
        existing_path = output_dir / canonical_name
        existing = json.loads(existing_path.read_text(encoding="utf-8")) if existing_path.is_file() else None
        if args.update_proposal:
            if existing is None or args.profile != "draft":
                raise ValueError("--update-proposal requires an existing canonical and --profile draft")
            original_stem = stem
            stem = safe_stem(original_stem[:100] + "_update-proposal")
            if stem.casefold() == original_stem.casefold():
                stem = safe_stem(original_stem[:100] + "_update-proposal-2")
            canonical_name = f"{stem}_requirements-functions-tests.json"
            # A second run must not erase edits made while reviewing the proposal.
            if any((output_dir / name).exists() for name in (
                canonical_name, f"{stem}_要件定義書.md", f"{stem}_機能一覧.md",
                f"{stem}_テスト一覧.md", f"{stem}_レビュー.html",
            )):
                raise ValueError("更新案が既に存在します。レビュー中の更新案を上書きしません。別の場所へ保管してから再実行してください。")
        if existing is not None:
            # Old sources may be stale. Editorial changes are protected by the
            # update guard; the candidate is validated against current sources.
            require_valid_model(existing)
        model = build_model(
            feature_dir,
            mode=args.mode,
            profile=args.profile,
            existing=existing,
            extra_manifest=args.extra_artifacts.resolve() if args.extra_artifacts else None,
            update_proposal=args.update_proposal,
        )
        require_valid_model(model, feature_dir)
        if args.profile == "publish" and model["report"]["blocking_errors"]:
            print(json.dumps(model["report"], ensure_ascii=False, indent=2), file=sys.stderr)
            return 1
        output_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="trace-docs-generate-", dir=output_dir.parent) as temporary:
            staged_dir = Path(temporary)
            canonical_path = staged_dir / canonical_name
            canonical_path.write_text(json_text(model), encoding="utf-8", newline="\n")
            rendered = write_rendered(model, staged_dir, stem, feature_dir)
            staged = [canonical_path, *rendered]
            for path in staged:
                os.replace(path, output_dir / path.name)
        for name in [canonical_name, f"{stem}_要件定義書.md", f"{stem}_機能一覧.md", f"{stem}_テスト一覧.md", f"{stem}_レビュー.html"]:
            print(output_dir / name)
        return 0
    except UpdateConflict as exc:
        print(f"update blocked: {exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
