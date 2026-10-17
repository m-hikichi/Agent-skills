#!/usr/bin/env python3
"""Validate sources, traceability and deterministic derived documents."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from document_model import SCHEMA_VERSION, evaluate_model
from generate_documents import feature_path
from render_documents import rendered_files, safe_stem
from schema_validation import require_valid_model


def main() -> int:
    parser = argparse.ArgumentParser(description="要件・機能・テストcanonical JSONと派生文書を検査")
    parser.add_argument("feature_or_spec", type=Path)
    parser.add_argument("canonical_json", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--profile", choices=("draft", "publish"), default="publish")
    parser.add_argument("--name", help="出力ファイル名の接頭辞")
    args = parser.parse_args()
    try:
        feature_dir = feature_path(args.feature_or_spec)
        model = json.loads(args.canonical_json.read_text(encoding="utf-8"))
        require_valid_model(model, feature_dir)
        if model.get("schema_version") != SCHEMA_VERSION:
            raise ValueError(f"unsupported schema_version: {model.get('schema_version')}")
        report = evaluate_model(model, feature_dir, args.profile)
        stem = safe_stem(args.name or args.canonical_json.name.removesuffix("_requirements-functions-tests.json").removesuffix(".json"))
        for name, expected in rendered_files(model, stem, feature_dir).items():
            path = args.output_dir / name
            if not path.is_file():
                report["axes"]["render_reproducibility"]["errors"].append(f"derived document missing: {name}")
            elif path.read_bytes() != expected.encode("utf-8"):
                report["axes"]["render_reproducibility"]["errors"].append(f"derived document is stale: {name}")
        render_axis = report["axes"]["render_reproducibility"]
        render_axis["metrics"] = {"errors": len(render_axis["errors"]), "warnings": len(render_axis["warnings"])}
        if render_axis["errors"]:
            render_axis["status"] = "failed"
        report["blocking_errors"] = sum(len(axis["errors"]) for axis in report["axes"].values())
        report["status"] = "blocked" if report["blocking_errors"] else ("publishable" if args.profile == "publish" else "draft-ready")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if report["blocking_errors"] else 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
