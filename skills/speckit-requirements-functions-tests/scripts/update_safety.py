"""Protect editorial work: unchanged inputs are a render, conflicts need review."""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any


class UpdateConflict(ValueError):
    """The old canonical must not be replaced by an unreviewed extraction."""


def editorial_digest(model: dict[str, Any]) -> str:
    # Include unknown future editorial fields, but not computed diagnostics or
    # source metadata. This is an edit detector, not a review attestation.
    ignored = {"report", "profile", "sources", "generation_digest"}
    payload = {key: value for key, value in model.items() if key not in ignored}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def retain_existing(existing: dict[str, Any] | None, sources: list[dict[str, Any]],
                    mode: str, profile: str, proposal: bool) -> dict[str, Any] | None:
    if not existing or proposal:
        return None
    same_sources = sorted(existing.get("sources", []), key=lambda x: x["path"]) == sorted(sources, key=lambda x: x["path"])
    if same_sources and existing.get("mode") == mode:
        retained = copy.deepcopy(existing)
        retained["profile"] = profile
        return retained
    baseline = existing.get("generation_digest")
    if baseline is None or baseline != editorial_digest(existing):
        raise UpdateConflict(
            "入力またはモードが変わり、既存JSONにはレビュー修正があるか、修正の有無を確認できません。"
            "既存資料は変更していません。--update-proposal を付けて別ファイルに更新案を生成し、"
            "既存JSONの機能分割・リンク・テスト・レビュー判断を比較して引き継いでください。"
        )
    return None
