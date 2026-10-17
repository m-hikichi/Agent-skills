"""Shared, conservative test specification readiness checks (not execution results)."""

from __future__ import annotations

import re
from typing import Any


FIELD_LABELS = {
    "preconditions": "事前条件", "steps": "操作・入力",
    "expected_result": "期待結果", "test_data": "テストデータ",
}
PLACEHOLDER = re.compile(
    r"\b(?:unspecified|tbd|todo|tbc)\b|未設定|未定|要確認|要具体化|後で記入|後日記入",
    re.IGNORECASE,
)
NOT_APPLICABLE = re.compile(r"^(?:n/?a|not applicable|該当なし|対象外|不要|なし)(?:\s*[:：\-（(]\s*(.+?)[）)]?)?$", re.IGNORECASE)
# Only balanced literal delimiters are masked; unmatched quotations remain prose.
QUOTED_LITERAL = re.compile(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`[^`]*`|「[^「」]*」|『[^『』]*』|“[^“”]*”|‘[^‘’]*’')
VAGUE_VALUE = re.compile(
    r"(?:適切な|適当な|有効な|正しい)(?:テスト)?データ(?:を使う|を使用する)?"
    r"|正しく動作する|正常に動作する|期待通りに動作する|操作する|準備済み"
    r"|(?:appropriate|suitable|valid|correct)\s+(?:test\s+)?data"
    r"|(?:it\s+)?works?\s+(?:correctly|properly|as expected)"
    r"|(?:perform|do)\s+(?:the\s+)?operation|ready|prepared",
    re.IGNORECASE,
)


def vague_value(text: str) -> bool:
    return bool(VAGUE_VALUE.fullmatch(text.strip(" \t\r\n。.!！")))


def unresolved_prose(text: str) -> bool:
    """Ignore quoted data only when accompanied by descriptive prose.

    This is a small lexical guard, not a proof that a natural-language test is
    executable. A quoted placeholder alone is still an unfinished field.
    """
    prose = QUOTED_LITERAL.sub(" ", text)
    has_context = bool(re.search(r"[A-Za-z0-9ぁ-んァ-ヶ一-龠]", prose))
    if has_context:
        return bool(PLACEHOLDER.search(prose))
    return bool(PLACEHOLDER.search(text))


def concrete_text(value: Any, allow_not_applicable: bool = False) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    text = value.strip()
    if unresolved_prose(text) or vague_value(text):
        return False
    literal = QUOTED_LITERAL.fullmatch(text)
    if literal and vague_value(text[1:-1]):
        return False
    exempt = NOT_APPLICABLE.fullmatch(text)
    if exempt:
        return bool(allow_not_applicable and exempt.group(1) and exempt.group(1).strip(" ()（）:：-"))
    return text not in {"-", "—", "...", "…", "?", "？"}


def missing_test_fields(test: dict[str, Any]) -> list[str]:
    """Return unresolved fields; explicit non-applicability needs a reason.

    Numeric test data are not universally required. Fixture references, input
    descriptions and reasoned non-applicability are all valid specifications.
    Natural-language correctness still needs an independent content review.
    """
    missing = []
    for key in FIELD_LABELS:
        value = test.get(key)
        allow_exemption = key in {"preconditions", "test_data"}
        if key == "expected_result":
            valid = concrete_text(value)
        else:
            valid = isinstance(value, list) and bool(value) and all(concrete_text(item, allow_exemption) for item in value)
        if not valid:
            missing.append(key)
    return missing
