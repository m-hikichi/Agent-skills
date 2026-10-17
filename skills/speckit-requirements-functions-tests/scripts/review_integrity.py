"""Bind a human/agent review attestation to the exact editorial model.

This detects changes after review. It is not a signature or a proof that the
reviewer's semantic judgment was correct.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

ALGORITHM = "sha256-canonical-v1"


def review_digest(model: dict[str, Any]) -> str:
    ignored = {"report", "profile", "generation_digest", "review_record"}
    payload = {key: value for key, value in model.items() if key not in ignored}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def review_issue(model: dict[str, Any]) -> str | None:
    record = model.get("review_record")
    if not isinstance(record, dict):
        return "review attestation is missing"
    if record.get("algorithm") != ALGORITHM or any(
        not isinstance(record.get(key), str) or not record[key].strip()
        for key in ("reviewer", "summary", "reviewed_digest")
    ):
        return "review attestation is incomplete"
    if record["reviewed_digest"] != review_digest(model):
        return "review attestation is stale; content changed after review"
    return None


def attest_review(model: dict[str, Any], *, expected_digest: str, reviewer: str, summary: str) -> None:
    """Call only AFTER independent review; does not resolve questions or fix data."""
    if not reviewer.strip() or not summary.strip():
        raise ValueError("reviewer and summary are required")
    current = review_digest(model)
    if expected_digest != current:
        raise ValueError("reviewed content has changed; review the current version before recording")
    model["review_record"] = {
        "algorithm": ALGORITHM, "reviewed_digest": current,
        "reviewer": reviewer.strip(), "summary": summary.strip(),
    }
