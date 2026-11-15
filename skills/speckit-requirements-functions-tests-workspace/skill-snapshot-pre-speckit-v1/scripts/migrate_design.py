# -*- coding: utf-8 -*-
"""Migrate legacy design JSON or generated HTML to a schema v3 draft."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from design_quality import (  # noqa: E402
    SCHEMA_VERSION,
    TYPE_LABELS,
    build_source_catalog,
    extract_normative_items,
    flatten_functions,
    normalize_config,
    validate_design,
)


class PanelRowsParser(HTMLParser):
    def __init__(self, panel_id):
        super().__init__()
        self.panel_id = panel_id
        self.in_panel = False
        self.in_tbody = False
        self.current_row = None
        self.current_cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "section" and attrs.get("id") == self.panel_id:
            self.in_panel = True
        elif self.in_panel and tag == "tbody":
            self.in_tbody = True
        elif self.in_tbody and tag == "tr":
            self.current_row = []
        elif self.current_row is not None and tag in {"td", "th"}:
            self.current_cell = {
                "text": [],
                "rowspan": int(attrs.get("rowspan", "1")),
                "class": attrs.get("class", ""),
            }
        elif self.current_cell is not None and tag == "br":
            self.current_cell["text"].append("\n")

    def handle_data(self, data):
        if self.current_cell is not None:
            self.current_cell["text"].append(data)

    def handle_endtag(self, tag):
        if tag in {"td", "th"} and self.current_cell is not None:
            self.current_cell["text"] = "".join(self.current_cell["text"]).strip()
            self.current_row.append(self.current_cell)
            self.current_cell = None
        elif tag == "tr" and self.current_row is not None:
            self.rows.append(self.current_row)
            self.current_row = None
        elif tag == "tbody" and self.in_tbody:
            self.in_tbody = False
        elif tag == "section" and self.in_panel:
            self.in_panel = False


def _expand_rowspans(rows, width):
    pending = {}
    expanded = []
    for row in rows:
        values = [None] * width
        next_pending = {}
        for column, (remaining, cell) in pending.items():
            values[column] = cell
            if remaining > 1:
                next_pending[column] = (remaining - 1, cell)
        column = 0
        for cell in row:
            while column < width and values[column] is not None:
                column += 1
            if column >= width:
                break
            values[column] = cell
            if cell["rowspan"] > 1:
                next_pending[column] = (cell["rowspan"] - 1, cell)
            column += 1
        pending = next_pending
        expanded.append(values)
    return expanded


def _cell(row, index):
    return row[index]["text"] if index < len(row) and row[index] else ""


def _parse_rules(text):
    return [part.strip() for part in re.split(r"(?:^|\n)・", text) if part.strip()]


def _parse_screens(text):
    refs = re.findall(r"\bSCR-\d+\b", text)
    return refs or ([text.strip()] if text.strip() and text.strip() != "—" else [])


def _legacy_from_html(html_text, title="機能一覧"):
    function_parser = PanelRowsParser("panel-func")
    function_parser.feed(html_text)
    if not function_parser.rows:
        raise ValueError("旧HTMLの機能一覧パネル(panel-func)を読み取れません")
    rows = _expand_rowspans(function_parser.rows, 11)

    function_list = []
    major_obj = middle_obj = minor_obj = None
    last_major = last_middle = last_minor = None
    for row in rows:
        major_key = (_cell(row, 0), _cell(row, 1))
        middle_key = (_cell(row, 2), _cell(row, 3))
        minor_key = (_cell(row, 4), _cell(row, 5))
        if major_key != last_major:
            major_obj = {"name": major_key[0], "id": major_key[1], "children": []}
            function_list.append(major_obj)
            last_major, last_middle, last_minor = major_key, None, None
        if middle_key != last_middle:
            middle_obj = {"name": middle_key[0], "id": middle_key[1], "children": []}
            major_obj["children"].append(middle_obj)
            last_middle, last_minor = middle_key, None
        if minor_key != last_minor:
            minor_obj = {"name": minor_key[0], "id": minor_key[1], "rows": []}
            middle_obj["children"].append(minor_obj)
            last_minor = minor_key
        name = re.sub(r"^将来対応\s*", "", _cell(row, 6))
        cells = [cell for cell in row if cell]
        future = any("future" in cell.get("class", "").split() for cell in cells[6:])
        minor_obj["rows"].append(
            {
                "機能名": name,
                "概要": _cell(row, 7),
                "業務ルール": _parse_rules(_cell(row, 8)),
                "画面": _parse_screens(_cell(row, 9)),
                "FR": _cell(row, 10),
                "future": future,
            }
        )

    screen_parser = PanelRowsParser("panel-screens")
    screen_parser.feed(html_text)
    screens = []
    for row in screen_parser.rows:
        if len(row) < 2:
            continue
        name = row[1]["text"]
        future = "将来対応" in name or any("future" in cell.get("class", "") for cell in row)
        screens.append(
            {
                "id": row[0]["text"],
                "name": name.replace("（将来対応）", ""),
                "summary": row[2]["text"] if len(row) > 2 else "",
                "roles": row[3]["text"] if len(row) > 3 else "",
                "future": future,
            }
        )
    title_match = re.search(r'<h1[^>]*class="title"[^>]*>(.*?)</h1>', html_text, re.S)
    return {
        "title": re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else title,
        "screens": screens,
        "function_list": function_list,
    }


def _add_traceability(cfg, spec_text):
    items = extract_normative_items(spec_text, cfg.get("source_catalog"))
    cfg["source_catalog"] = build_source_catalog(items)
    existing_trace = {
        str(entry.get("source_id", "")).upper(): entry
        for entry in cfg.get("traceability", []) or []
        if isinstance(entry, dict)
    }
    mapped = {}
    for _, _, _, function in flatten_functions(cfg):
        for ref in function.get("source_refs", []) or []:
            mapped.setdefault(ref, []).append(function.get("id"))
    traceability = []
    unresolved_by_type = {}
    for item in items:
        function_ids = mapped.get(item["id"], [])
        if item["source_status"] == "future":
            coverage = "future"
        elif item["source_status"] == "out-of-scope":
            coverage = "out-of-scope"
        elif function_ids:
            coverage = "covered"
        else:
            coverage = "unresolved"
        previous = existing_trace.get(item["id"], {})
        traceability.append(
            {
                "source_id": item["id"],
                "function_ids": function_ids,
                "coverage": coverage,
                "rationale": previous.get("rationale")
                or ("旧成果物から自動移行" if function_ids else "対応機能を確認してください"),
                **({"verification": previous["verification"]} if previous.get("verification") else {}),
            }
        )
        if coverage == "unresolved":
            unresolved_by_type.setdefault(item["type"], []).append(item["id"])
    for index, (item_type, source_ids) in enumerate(unresolved_by_type.items(), 1):
        label = TYPE_LABELS.get(item_type, item_type)
        cfg["open_questions"].append(
            {
                "id": f"Q-TRACE-{index:03d}",
                "topic": f"traceability-{item_type}",
                "severity": "blocking",
                "question": f"未対応の{label}を充足する機能または検証方法をまとめて確認してください: {', '.join(source_ids)}",
                "source_refs": source_ids,
            }
        )
    cfg["traceability"] = traceability
    return cfg


def _refs(value):
    if isinstance(value, list):
        values = value
    else:
        values = re.split(r"[,、\s]+", str(value or ""))
    return [str(value).strip().upper() for value in values if str(value).strip()]


def _derived_fact(text, source_refs, **extra):
    return {
        **extra,
        "text": str(text or "").strip(),
        "basis": "derived",
        "source_refs": list(dict.fromkeys(_refs(source_refs))),
        "rationale": "v1/v2の設計値を意味を変えずにv3 factへ移行",
    }


def _upgrade_provenance(record, default_refs):
    record = dict(record) if isinstance(record, dict) else {"text": str(record or "")}
    record.setdefault("basis", "derived")
    record.setdefault("source_refs", list(default_refs))
    if record.get("basis") == "derived":
        record.setdefault("rationale", "v1/v2の設計値を意味を変えずにv3へ移行")
    if record.get("basis") == "confirmed" and not record.get("confirmation"):
        confirmation = next((ref for ref in _refs(record.get("source_refs")) if ref.startswith("CL-")), "")
        if confirmation:
            record["confirmation"] = confirmation
    return record


def _next_question_id(cfg, stem):
    existing = {str(question.get("id", "")) for question in cfg.get("open_questions", []) or []}
    number = 1
    while f"Q-MIG-{stem}-{number:03d}" in existing:
        number += 1
    return f"Q-MIG-{stem}-{number:03d}"


def _append_blocking_question(
    cfg, stem, topic, question, source_refs=None, function_ids=None, return_to="/speckit.plan"
):
    function_ids = [str(value) for value in (function_ids or []) if str(value)]
    refs = list(dict.fromkeys(_refs(source_refs)))
    cfg.setdefault("open_questions", []).append(
        {
            "id": _next_question_id(cfg, stem),
            "topic": topic,
            "severity": "blocking",
            "status": "open",
            "question": question,
            "source_refs": refs,
            "function_ids": function_ids,
            "affected_refs": [f"function:{value}" for value in function_ids]
            or [f"source:{value}" for value in refs],
            "return_to": return_to,
        }
    )


def _upgrade_to_v3(spec_text, cfg, from_version):
    """Create a reviewable v3 draft while preserving function/category identity."""
    cfg = json.loads(json.dumps(cfg, ensure_ascii=False))
    source_path = str((cfg.get("source") or {}).get("spec") or "spec.md")
    cfg["schema_version"] = SCHEMA_VERSION
    cfg["document_level"] = "functional-design"
    cfg.pop("quality", None)
    cfg["source"] = {
        **(cfg.get("source") or {}),
        "artifacts": [
            {
                "id": "SRC-SPEC",
                "type": "spec",
                "path": source_path,
                "locator": "文書全体（見出しはsource_catalogで追跡）",
                "fingerprint": hashlib.sha256(spec_text.encode("utf-8")).hexdigest(),
            }
        ],
    }

    entity_sources = {}
    functions = flatten_functions(cfg)
    migrated_function_ids = []
    migrated_function_refs = set()
    for _, _, _, function in functions:
        function_id = str(function.get("id", ""))
        function_refs = _refs(function.get("source_refs"))
        migrated_function_ids.append(function_id)
        migrated_function_refs.update(function_refs)
        legacy_actors = [str(value).strip() for value in function.get("actors", []) or [] if str(value).strip()]
        function["actors"] = {
            "initiators": ["要確認"],
            "processors": ["要確認"],
            "recipients": legacy_actors,
            "operators": [],
        }
        function["trigger"] = _derived_fact(function.get("trigger", ""), function_refs)
        for key in ("inputs", "outputs", "preconditions", "postconditions"):
            function[key] = [
                _derived_fact(value, function_refs)
                for value in function.get(key, []) or []
            ]
        migrated_entities = []
        for value in function.get("data_entities", []) or []:
            name = str(value.get("name") if isinstance(value, dict) else value).strip()
            if not name:
                continue
            entity_sources.setdefault(name, set()).update(function_refs)
            migrated_entities.append(_derived_fact(name, function_refs, name=name))
        function["data_entities"] = migrated_entities
        function["business_rules"] = [
            _upgrade_provenance(record, function_refs)
            for record in function.get("business_rules", []) or []
        ]
        function["exceptions"] = [
            _upgrade_provenance(record, function_refs)
            for record in function.get("exceptions", []) or []
        ]
    if migrated_function_ids and not any(
        question.get("topic") == "legacy-design-details" for question in cfg.get("open_questions", []) or []
    ):
        _append_blocking_question(
            cfg,
            "ACTOR",
            "v3-actor-roles",
            "全機能の起動者・処理主体・受信者・運用担当、および移行した入出力・条件の根拠を確認してください",
            sorted(migrated_function_refs),
            migrated_function_ids,
            "/speckit.clarify",
        )

    entities = []
    entity_ids = {}
    for index, (name, refs) in enumerate(sorted(entity_sources.items()), 1):
        entity_id = f"ENT-{index:03d}"
        entity_ids[name] = entity_id
        entities.append(
            {
                "id": entity_id,
                "name": name,
                "kind": "logical",
                "attributes": [],
                "constraints": [],
                "relationships": [],
                "basis": "derived",
                "source_refs": sorted(refs),
                "rationale": "v2機能のdata_entitiesから論理エンティティ候補を抽出",
            }
        )
    for _, _, _, function in functions:
        for fact in function.get("data_entities", []) or []:
            fact["entity_id"] = entity_ids.get(fact.get("name"), "")
    cfg["entities"] = entities
    if entities:
        _append_blocking_question(
            cfg,
            "ENTITY",
            "v3-logical-entities",
            "移行した論理エンティティの属性・関係・ライフサイクルを確認してください",
            sorted({ref for refs in entity_sources.values() for ref in refs}),
            [function.get("id") for _, _, _, function in functions],
            "/speckit.plan",
        )

    verification = []
    missing_verification = []
    trace_by_id = {str(entry.get("source_id", "")): entry for entry in cfg.get("traceability", []) or []}
    for item in extract_normative_items(spec_text, cfg.get("source_catalog")):
        if item.get("type") != "success-criterion":
            continue
        trace = trace_by_id.get(item["id"], {})
        method = str(trace.get("verification", "")).strip()
        if not method:
            missing_verification.append(item["id"])
            continue
        verification_id = f"VER-{len(verification) + 1:03d}"
        verification.append(
            {
                "id": verification_id,
                "source_id": item["id"],
                "method": method,
                "expected_result": item["text"],
                "basis": "derived",
                "source_refs": [item["id"]],
                "rationale": "v2 traceability.verificationをv3検証レコードへ移行",
            }
        )
        trace["verification_ids"] = [verification_id]
    cfg["verification"] = verification
    if missing_verification:
        _append_blocking_question(
            cfg,
            "VERIFY",
            "v3-success-criteria-verification",
            "全Success Criteriaの検証方法と期待結果を定義してください: " + ", ".join(missing_verification),
            missing_verification,
            return_to="/speckit.plan",
        )

    cfg["workflows"] = []
    cfg["state_models"] = []
    cfg["architecture"] = {"status": "not-evaluated"}
    cfg["quality_scenarios"] = []
    cfg["risks"] = []
    cfg["applicability"] = {
        "workflows": {"status": "not-evaluated", "rationale": ""},
        "state_models": {"status": "not-evaluated", "rationale": ""},
    }
    cfg.pop("delivery_summary", None)
    _append_blocking_question(
        cfg,
        "FLOW",
        "v3-workflow-applicability",
        "複数機能・実行境界を横断する重要シナリオに処理フローが必要か判定してください",
        [item["id"] for item in extract_normative_items(spec_text, cfg.get("source_catalog"))],
        return_to="/speckit.plan",
    )
    _append_blocking_question(
        cfg,
        "STATE",
        "v3-state-model-applicability",
        "状態によって操作可否が変わる業務エンティティに状態遷移表が必要か判定してください",
        [item["id"] for item in extract_normative_items(spec_text, cfg.get("source_catalog"))],
        return_to="/speckit.plan",
    )

    for question in cfg.get("open_questions", []) or []:
        refs = list(dict.fromkeys(_refs(question.get("source_refs"))))
        question["source_refs"] = refs or ["SRC-SPEC"]
        function_ids = [
            str(value) for value in (question.get("function_ids") or []) if str(value)
        ]
        question.setdefault(
            "affected_refs",
            [f"function:{value}" for value in function_ids]
            or [f"source:{value}" for value in question["source_refs"]],
        )
        topic = str(question.get("topic", ""))
        default_return = "/speckit.clarify" if topic.startswith("traceability") or "legacy" in topic else "/speckit.plan"
        question.setdefault("return_to", default_return)

    migration = cfg.setdefault("migration", {})
    migration["from_version"] = from_version
    migration["to_version"] = SCHEMA_VERSION
    warnings = list(migration.get("warnings", []) or [])
    warnings.append("v3ドラフトへ移行しました。blocking questionsを解消してから準備度を確定してください")
    migration["warnings"] = list(dict.fromkeys(warnings))
    return cfg


def migrate(spec_text, source, source_name="legacy"):
    if isinstance(source, str):
        legacy = _legacy_from_html(source)
    else:
        legacy = source
    from_version = int(legacy.get("schema_version", 1) or 1) if isinstance(legacy, dict) else 1
    cfg = normalize_config(legacy)
    cfg.setdefault("source", {})["spec"] = "spec.md"
    if cfg.get("schema_version") == SCHEMA_VERSION:
        upgraded = cfg
        upgraded["source"]["artifacts"] = upgraded["source"].get("artifacts") or [
            {
                "id": "SRC-SPEC",
                "type": "spec",
                "path": "spec.md",
                "locator": "文書全体（見出しはsource_catalogで追跡）",
                "fingerprint": hashlib.sha256(spec_text.encode("utf-8")).hexdigest(),
            }
        ]
    else:
        cfg = _add_traceability(cfg, spec_text)
        upgraded = _upgrade_to_v3(spec_text, cfg, from_version)
    upgraded.setdefault("migration", {})["source"] = source_name
    upgraded.pop("quality", None)
    upgraded, report, _ = validate_design(spec_text, upgraded)
    upgraded["report"] = report
    return upgraded


def main():
    parser = argparse.ArgumentParser(description="旧設計JSON/HTMLをv3ドラフトへ移行")
    parser.add_argument("spec", help="要求の正本 spec.md")
    parser.add_argument("legacy", help="旧design.jsonまたは生成済みHTML")
    parser.add_argument("-o", "--output", help="出力 *.design.json")
    args = parser.parse_args()

    spec_path = Path(args.spec)
    legacy_path = Path(args.legacy)
    spec_text = spec_path.read_text(encoding="utf-8")
    if legacy_path.suffix.lower() == ".json":
        source = json.loads(legacy_path.read_text(encoding="utf-8"))
    else:
        source = legacy_path.read_text(encoding="utf-8")
    cfg = migrate(spec_text, source, str(legacy_path))
    cfg["source"]["spec"] = spec_path.name
    for artifact in cfg["source"].get("artifacts", []):
        if artifact.get("type") == "spec":
            artifact["path"] = spec_path.name
            artifact["fingerprint"] = hashlib.sha256(spec_path.read_bytes()).hexdigest()
    output = Path(args.output) if args.output else legacy_path.with_suffix(".design.json")
    output.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {output} (v3 functional-designドラフト / 要確認 {len(cfg['open_questions'])}件)")


if __name__ == "__main__":
    main()
