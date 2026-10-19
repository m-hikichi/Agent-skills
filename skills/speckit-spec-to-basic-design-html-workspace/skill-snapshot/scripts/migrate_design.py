# -*- coding: utf-8 -*-
"""Migrate legacy design JSON or generated HTML to schema v2 draft JSON."""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from design_quality import (  # noqa: E402
    TYPE_LABELS,
    build_source_catalog,
    extract_normative_items,
    flatten_functions,
    normalize_config,
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
        traceability.append(
            {
                "source_id": item["id"],
                "function_ids": function_ids,
                "coverage": coverage,
                "rationale": "旧成果物から自動移行" if function_ids else "対応機能を確認してください",
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


def migrate(spec_text, source, source_name="legacy"):
    if isinstance(source, str):
        legacy = _legacy_from_html(source)
    else:
        legacy = source
    cfg = normalize_config(legacy)
    cfg.setdefault("source", {})["spec"] = "spec.md"
    cfg["migration"]["source"] = source_name
    return _add_traceability(cfg, spec_text)


def main():
    parser = argparse.ArgumentParser(description="旧設計JSON/HTMLをv2ドラフトへ移行")
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
    cfg["source"]["spec"] = str(spec_path)
    output = Path(args.output) if args.output else legacy_path.with_suffix(".design.json")
    output.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"saved {output} (v2ドラフト / 要確認 {len(cfg['open_questions'])}件)")


if __name__ == "__main__":
    main()
