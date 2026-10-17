#!/usr/bin/env python3
"""Inspect a review version, then explicitly record completed independent review."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile

from document_model import evaluate_model, json_text
from review_integrity import attest_review, review_digest
from schema_validation import require_valid_model


def main() -> int:
    parser = argparse.ArgumentParser(description="レビュー対象の版を確認し、完了した独立レビューを記録する（自動承認ではありません）")
    parser.add_argument("action", choices=("digest", "record"))
    parser.add_argument("canonical_json", type=Path)
    parser.add_argument("--feature-dir", type=Path, required=True)
    parser.add_argument("--expected-digest", help="実際にレビューした版のdigest")
    parser.add_argument("--reviewer", help="実際のレビュー担当者・エージェント名")
    parser.add_argument("--summary", help="確認範囲・判断の根拠。実施していないレビューは記録しない")
    args = parser.parse_args()
    try:
        path = args.canonical_json.resolve()
        original = path.read_bytes()
        model = json.loads(original.decode("utf-8-sig"))
        feature = args.feature_dir.resolve()
        require_valid_model(model, feature)
        if args.action == "digest":
            print(review_digest(model))
            return 0
        if not all((args.expected_digest, args.reviewer, args.summary)):
            raise ValueError("record requires --expected-digest, --reviewer and --summary")
        attest_review(model, expected_digest=args.expected_digest, reviewer=args.reviewer, summary=args.summary)
        report = evaluate_model(model, feature, "publish")
        if report["blocking_errors"]:
            print(json.dumps(report, ensure_ascii=False, indent=2), file=sys.stderr)
            return 1
        model["report"] = evaluate_model(model, feature, model["profile"])
        require_valid_model(model, feature)
        # Refuse to discard edits made between loading and recording.
        if path.read_bytes() != original:
            raise ValueError("canonical changed while recording; nothing was written")
        with tempfile.TemporaryDirectory(prefix="review-record-", dir=path.parent) as temporary:
            staged = Path(temporary) / path.name
            staged.write_text(json_text(model), encoding="utf-8", newline="\n")
            os.replace(staged, path)
        print(f"レビュー記録を保存しました。renderとcheckを再実行してください: {path}")
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
