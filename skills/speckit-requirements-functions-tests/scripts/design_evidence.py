"""Conservative extraction of explicitly labelled design-test evidence.

This is not a general Markdown/OpenAPI interpreter. Unsupported evidence stays
available to the caller for review; no request, outcome or requirement is guessed.
"""
from __future__ import annotations

import re
from typing import Any


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("**", "")).strip(" ,;、")


def explicit_ids(text: str, known: set[str]) -> list[str]:
    return sorted(identity for identity in known if re.search(
        r"(?<![A-Za-z0-9.-])" + re.escape(identity) + r"(?![A-Za-z0-9.-])", text))


def gwt_scenarios(text: str) -> list[dict[str, Any]]:
    """Separate explicit GWT triples, including Markdown labels on separate lines."""
    text = text.replace("**", "")
    text = re.sub(r"(?m)^\s*(?:[-*]|\d+[.)])\s+", "", text)
    pattern = re.compile(
        r"\bGiven\s*:?\s+(.+?)\s*[,;、]?\s*\bWhen\s*:?\s+(.+?)"
        r"\s*[,;、]?\s*\bThen\s*:?\s+(.+?)(?=\s*\bGiven\s*:?\s+|\Z)",
        re.I | re.S,
    )
    return [{"preconditions": [clean(match[1])], "steps": [clean(match[2])],
             "expected_result": clean(match[3]), "test_data": []}
            for match in pattern.finditer(text)]


def extract_design_scenarios(content: str, known: set[str], *, contract: bool = False) -> tuple[list[dict[str, Any]], set[int]]:
    """Return scenarios and consumed 1-based lines with explicit requirement scope.

    Requirement IDs may be on a scenario, a section heading, or a standalone
    'Requirements:' line in that section. Table rows may override that scope.
    """
    lines = content.splitlines()
    # A fenced example is not an executable acceptance statement. Preserve line
    # numbers but leave these lines unconsumed for the caller's review evidence.
    fence = None
    visible_lines = []
    for line in lines:
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if fence:
            visible_lines.append("")
            if marker and marker[1][0] == fence[0] and len(marker[1]) >= len(fence):
                fence = None
        elif marker:
            fence = marker[1]
            visible_lines.append("")
        else:
            visible_lines.append(line)
    lines = visible_lines
    scenarios: list[dict[str, Any]] = []
    consumed: set[int] = set()
    scope: list[str] = []
    scope_lines: list[int] = []
    heading_scopes: list[tuple[int, list[str], list[int]]] = []
    index = 0
    aliases = {
        "requirement": {"requirement", "requirements", "requirement id", "req", "要件", "要件id", "対応要件"},
        "from": {"from", "from state", "initial state", "current state", "遷移元", "現在状態", "現在の状態"},
        "event": {"event", "trigger", "action", "イベント", "操作", "契機"},
        "to": {"to", "to state", "next state", "expected state", "遷移先", "次状態", "次の状態"},
        "data": {"test data", "data", "テストデータ", "入力データ"},
    }

    def add(parts: dict[str, Any], ids: list[str], numbers: list[int], kind: str) -> None:
        if not ids:
            return
        scenarios.append({**parts, "requirement_ids": ids, "line_numbers": sorted(set(numbers + scope_lines)), "kind": kind})
        consumed.update(numbers)
        consumed.update(scope_lines)

    while index < len(lines):
        line = lines[index]
        heading = re.match(r"^\s*(#+)\s", line)
        if heading:
            # Do not leak a section's requirement scope into its sibling.
            depth = len(heading[1])
            while heading_scopes and heading_scopes[-1][0] >= depth:
                heading_scopes.pop()
            own_ids = explicit_ids(line, known)
            if own_ids:
                scope, scope_lines = own_ids, [index + 1]
            elif heading_scopes:
                _, scope, scope_lines = heading_scopes[-1]
            else:
                scope, scope_lines = [], []
            heading_scopes.append((depth, scope, scope_lines))
            index += 1
            continue
        if re.match(r"^\s*(?:Requirements?|要件|対応要件)\s*[:：]", line.replace("**", ""), re.I):
            scope = explicit_ids(line, known)
            scope_lines = [index + 1] if scope else []
            if heading_scopes:
                heading_scopes[-1] = (heading_scopes[-1][0], scope, scope_lines)
            index += 1
            continue
        if not line.strip():
            index += 1
            continue
        inline = gwt_scenarios(line)
        if inline:
            for triple in inline:
                add(triple, explicit_ids(line, known) or scope, [index + 1], "gwt")
            index += 1
            continue
        if "|" in line and index + 1 < len(lines) and re.fullmatch(r"[\s|:-]+", lines[index + 1]):
            headers = [clean(cell).casefold() for cell in line.strip().strip("|").split("|")]
            columns = {key: next((pos for pos, value in enumerate(headers) if value in names), None)
                       for key, names in aliases.items()}
            start = index
            index += 2
            while index < len(lines) and "|" in lines[index] and lines[index].strip():
                cells = [clean(cell) for cell in lines[index].strip().strip("|").split("|")]
                if all(columns[key] is not None and columns[key] < len(cells) and cells[columns[key]]
                       for key in ("from", "event", "to")):
                    req_col = columns["requirement"]
                    ids = explicit_ids(cells[req_col], known) if req_col is not None and req_col < len(cells) else scope
                    data_col = columns["data"]
                    add({"preconditions": [cells[columns["from"]]], "steps": [cells[columns["event"]]],
                         "expected_result": cells[columns["to"]],
                         "test_data": [cells[data_col]] if data_col is not None and data_col < len(cells) and cells[data_col] else []},
                        ids, [start + 1, start + 2, index + 1], "state")
                index += 1
            continue
        # Read a paragraph. GWT labels may be split across lines, but unrelated
        # sections/paragraphs are never concatenated to manufacture a scenario.
        start = index
        while index < len(lines) and lines[index].strip() and not re.match(r"^\s*#", lines[index]):
            if index > start and re.search(r"\bGiven\b", lines[index], re.I) and re.search(r"\bThen\b", "\n".join(lines[start:index]), re.I):
                break
            if contract and index > start and re.match(r"^\s*(?:[-*]\s+)?(?:\*\*)?(?:Request|リクエスト)(?:\*\*)?\s*[:：]", lines[index], re.I) and re.search(r"(?:Response|レスポンス)(?:\*\*)?\s*[:：]", "\n".join(lines[start:index]), re.I):
                break
            index += 1
        block = "\n".join(lines[start:index])
        ids = explicit_ids(block, known) or scope
        triples = gwt_scenarios(block)
        for triple in triples:
            add(triple, ids, list(range(start + 1, index + 1)), "gwt")
        if not triples and contract:
            labels = re.compile(r"(?im)^\s*(?:[-*]\s+)?(?:\*\*)?(Request|Response|Preconditions?|Test Data|リクエスト|レスポンス|事前条件|テストデータ)(?:\*\*)?\s*[:：]\s*")
            matches = list(labels.finditer(block))
            fields = {match[1].casefold(): clean(block[match.end():matches[pos + 1].start() if pos + 1 < len(matches) else len(block)])
                      for pos, match in enumerate(matches)}
            request = fields.get("request", fields.get("リクエスト", ""))
            response = fields.get("response", fields.get("レスポンス", ""))
            precondition = fields.get("preconditions", fields.get("precondition", fields.get("事前条件", "")))
            data = fields.get("test data", fields.get("テストデータ", ""))
            if request and response:
                add({"preconditions": [precondition] if precondition else [], "steps": [request],
                     "expected_result": response, "test_data": [data] if data else []},
                    ids, list(range(start + 1, index + 1)), "contract")
    return scenarios, consumed
