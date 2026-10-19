# -*- coding: utf-8 -*-
"""Validate design schema v2 against spec.md and optionally inspect rendered HTML."""

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

from design_quality import build_source_catalog, extract_normative_items, validate_design  # noqa: E402


REQUIRED_V2_PANELS = {
    "panel-functions",
    "panel-details",
    "panel-traceability",
    "panel-interfaces",
    "panel-quality",
}


class FunctionTableParser(HTMLParser):
    """Legacy function-table reader retained for v1 HTML compatibility checks."""

    def __init__(self):
        super().__init__()
        self.in_panel = False
        self.in_tbody = False
        self.current_row = None
        self.current_cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "section" and attrs.get("id") in {"panel-func", "panel-functions"}:
            self.in_panel = True
        elif self.in_panel and tag == "tbody":
            self.in_tbody = True
        elif self.in_tbody and tag == "tr":
            self.current_row = []
        elif self.current_row is not None and tag == "td":
            self.current_cell = {
                "class": set(attrs.get("class", "").split()),
                "rowspan": int(attrs.get("rowspan", "1")),
                "text": [],
            }
        elif self.current_cell is not None and tag == "br":
            self.current_cell["text"].append(" ")

    def handle_data(self, data):
        if self.current_cell is not None:
            self.current_cell["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "td" and self.current_cell is not None:
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


def _panel(text, panel_id):
    match = re.search(
        rf'<section class="[^"]*" id="{re.escape(panel_id)}"[^>]*>(.*?)</section>',
        text,
        re.DOTALL,
    )
    return match.group(1) if match else ""


def check_html_structure(html_text, require_v2=False):
    errors = []
    warnings = []
    if re.search(r"\sstyle\s*=", html_text, re.IGNORECASE):
        errors.append("style属性が含まれています")
    if re.search(r'<(?:link|script|img)\b[^>]*(?:src|href)=["\']https?://', html_text, re.I):
        errors.append("外部アセットURLが含まれています")
    if require_v2:
        missing = [panel for panel in sorted(REQUIRED_V2_PANELS) if f'id="{panel}"' not in html_text]
        if missing:
            errors.append("必須パネルがありません: " + ", ".join(missing))
        if 'role="tablist"' not in html_text or 'role="tab"' not in html_text or 'aria-controls=' not in html_text:
            errors.append("タブのアクセシビリティ属性が不足しています")
        if '<caption' not in html_text or 'scope="col"' not in html_text:
            errors.append("表のcaptionまたは列見出しscopeが不足しています")
        details = set(re.findall(r'id="detail-(FNC-\d{3,})"', html_text))
        links = set(re.findall(r'data-detail="(FNC-\d{3,})"', html_text))
        dangling = links - details
        if dangling:
            errors.append("機能詳細へのリンク先がありません: " + ", ".join(sorted(dangling)))
    return errors, warnings


def check(spec_text, html_text):
    """Legacy v1 HTML check kept as a public compatibility function."""
    errors, warnings = check_html_structure(html_text)
    function_panel = _panel(html_text, "panel-func") or _panel(html_text, "panel-functions")
    if not function_panel:
        errors.append("機能一覧パネルがありません")
        return errors, warnings

    spec_fr = {item["id"] for item in extract_normative_items(spec_text) if item["type"] == "functional-requirement"}
    html_fr = set(re.findall(r"\bFR-\d+\b", function_panel))
    missing = spec_fr - html_fr
    invented = html_fr - spec_fr
    if missing:
        errors.append("機能一覧に無い要求ID: " + ", ".join(sorted(missing)))
    if invented:
        errors.append("specに無い要求ID: " + ", ".join(sorted(invented)))

    function_lines = [line for line in function_panel.splitlines() if "<tr" in line and ("frcol" in line or "FNC-" in line)]
    for index, line in enumerate(function_lines, 1):
        if line.count("<tr") != 1 or line.count("</tr>") != 1:
            errors.append(f"機能行 {index} が物理1行に収まっていません")
        if '<span class="muted">—</span>' in line:
            errors.append(f"機能行 {index} に必須項目の空欄があります")

    screen_panel = _panel(html_text, "panel-screens")
    if screen_panel:
        defined_screens = set(re.findall(r"\bSCR-\d+\b", screen_panel))
        referenced_screens = set(re.findall(r"\bSCR-\d+\b", function_panel))
        if referenced_screens - defined_screens:
            errors.append("未定義の画面参照: " + ", ".join(sorted(referenced_screens - defined_screens)))
        if defined_screens - referenced_screens:
            errors.append("未参照の画面マスタ: " + ", ".join(sorted(defined_screens - referenced_screens)))

    parser = FunctionTableParser()
    parser.feed(html_text)
    row_future = []
    for row in parser.rows:
        function_cell = next((cell for cell in row if "g" in cell["class"]), None)
        row_future.append(bool(function_cell and "future" in function_cell["class"]))
        screen_cell = next((cell for cell in row if "scrcol" in cell["class"]), None)
        function_cells = [cell for cell in row if "g" in cell["class"]]
        function_text = " ".join(cell["text"] for cell in function_cells[:2])
        if screen_cell and screen_cell["text"] == "全画面共通" and any(
            word in function_text for word in ("自動", "バッチ", "通知送信", "期限超過通知", "集計")
        ):
            errors.append(f"自動処理「{function_cells[0]['text']}」が全画面共通になっています")

    category_classes = {"dai", "chu", "sho0", "sho1"}
    for row_index, row in enumerate(parser.rows):
        for cell in row:
            classes = cell["class"]
            is_future_category = classes == {"future"}
            is_current_category = bool(classes & category_classes)
            if not (is_future_category or is_current_category):
                continue
            end = min(row_index + cell["rowspan"], len(row_future))
            covered = row_future[row_index:end]
            if is_future_category and not all(covered):
                errors.append(f"分類「{cell['text']}」が現行行を含むのに将来対応色です")
            if is_current_category and covered and all(covered):
                errors.append(f"分類「{cell['text']}」の全行が将来対応なのに通常色です")
    return errors, warnings


def _write_quality(path, cfg, report, items):
    updated = dict(cfg)
    updated["quality"] = report
    updated["source_catalog"] = build_source_catalog(items)
    path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="spec.mdと基本設計成果物の品質検査")
    parser.add_argument("spec", help="要求の正本 spec.md")
    parser.add_argument("design", help="v2 *.design.json、または互換検査対象の旧HTML")
    parser.add_argument("html", nargs="?", help="v2 JSONから生成したHTML（任意）")
    parser.add_argument("--write-report", action="store_true", help="品質レポートをv2 JSONへ保存")
    args = parser.parse_args()

    spec_text = Path(args.spec).read_text(encoding="utf-8")
    design_path = Path(args.design)
    if design_path.suffix.lower() == ".json":
        cfg = json.loads(design_path.read_text(encoding="utf-8"))
        _, report, items = validate_design(spec_text, cfg)
        errors = list(report["errors"])
        warnings = list(report["warnings"])
        if args.html:
            html_errors, html_warnings = check_html_structure(Path(args.html).read_text(encoding="utf-8"), require_v2=True)
            errors.extend(html_errors)
            warnings.extend(html_warnings)
        if args.write_report:
            if cfg.get("schema_version") != 2:
                errors.append("旧形式へ品質レポートは書き込めません。先にv2へ移行してください")
            else:
                report = dict(report)
                report["errors"] = errors
                report["warnings"] = warnings
                report["blocking_error_count"] = len(errors)
                report["warning_count"] = len(warnings)
                report["status"] = "passed" if not errors else "failed"
                _write_quality(design_path, cfg, report, items)
    else:
        errors, warnings = check(spec_text, design_path.read_text(encoding="utf-8"))

    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"OK: ブロッキング 0件 / 警告 {len(warnings)}件")


if __name__ == "__main__":
    main()
