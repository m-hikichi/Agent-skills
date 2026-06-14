# -*- coding: utf-8 -*-
"""生成済みの基本設計HTMLを、spec.mdと成果物の両面から検査する。"""
import argparse
import re
import sys
from html.parser import HTMLParser


class FunctionTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_panel = False
        self.in_tbody = False
        self.current_row = None
        self.current_cell = None
        self.rows = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "section" and attrs.get("id") == "panel-func":
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
        rf'<section class="[^"]*" id="{re.escape(panel_id)}">(.*?)</section>',
        text,
        re.DOTALL,
    )
    return match.group(1) if match else ""


def check(spec_text, html_text):
    errors = []
    warnings = []

    if re.search(r"\sstyle\s*=", html_text, re.IGNORECASE):
        errors.append("style属性が含まれています")
    if re.search(
        r'<(?:link|script|img)\b[^>]*(?:src|href)=["\']https?://',
        html_text,
        re.IGNORECASE,
    ):
        errors.append("外部アセットURLが含まれています")

    function_panel = _panel(html_text, "panel-func")
    if not function_panel:
        errors.append("機能一覧パネルがありません")
        return errors, warnings

    spec_fr = set(re.findall(r"\bFR-\d+\b", spec_text))
    html_fr = set(re.findall(r"\bFR-\d+\b", function_panel))
    missing = spec_fr - html_fr
    invented = html_fr - spec_fr
    if missing:
        errors.append("機能一覧に無い要求ID: " + ", ".join(sorted(missing)))
    if invented:
        errors.append("specに無い要求ID: " + ", ".join(sorted(invented)))

    function_lines = [
        line for line in function_panel.splitlines()
        if "<tr>" in line and "frcol" in line
    ]
    if spec_fr and len(function_lines) > len(spec_fr) * 3:
        errors.append(
            f"機能行が {len(function_lines)}件あり、実在FR {len(spec_fr)}件の3倍を超えています"
        )
    for index, line in enumerate(function_lines, 1):
        if line.count("<tr>") != 1 or line.count("</tr>") != 1:
            errors.append(f"機能行 {index} が物理1行に収まっていません")
        if '<span class="muted">—</span>' in line:
            errors.append(f"機能行 {index} に必須項目の空欄があります")

    screen_panel = _panel(html_text, "panel-screens")
    defined_screens = set(re.findall(r"\bSCR-\d+\b", screen_panel))
    referenced_screens = set(re.findall(r"\bSCR-\d+\b", function_panel))
    undefined_screens = referenced_screens - defined_screens
    unused_screens = defined_screens - referenced_screens
    if undefined_screens:
        errors.append("未定義の画面参照: " + ", ".join(sorted(undefined_screens)))
    if unused_screens:
        errors.append("未参照の画面マスタ: " + ", ".join(sorted(unused_screens)))

    parser = FunctionTableParser()
    parser.feed(html_text)
    row_future = []
    for row in parser.rows:
        function_cell = next((cell for cell in row if "g" in cell["class"]), None)
        row_future.append(bool(function_cell and "future" in function_cell["class"]))
        screen_cell = next((cell for cell in row if "scrcol" in cell["class"]), None)
        function_cells = [cell for cell in row if "g" in cell["class"]]
        function_text = " ".join(cell["text"] for cell in function_cells[:2])
        if (
            screen_cell
            and screen_cell["text"] == "全画面共通"
            and any(word in function_text for word in ("自動", "バッチ", "通知送信", "期限超過通知", "集計"))
        ):
            errors.append(
                f"自動処理「{function_cells[0]['text']}」が全画面共通になっています"
            )

    category_classes = {"dai", "chu", "sho0", "sho1"}
    for row_index, row in enumerate(parser.rows):
        for cell in row:
            classes = cell["class"]
            is_future_category = classes == {"future"}
            is_current_category = bool(classes & category_classes)
            if not (is_future_category or is_current_category):
                continue
            if classes & {"dai"} and cell["text"] in {"Requirements", "機能要件", "User Stories"}:
                errors.append(f"文書見出し「{cell['text']}」を大分類名に使っています")
            end = min(row_index + cell["rowspan"], len(row_future))
            covered = row_future[row_index:end]
            if is_future_category and not all(covered):
                errors.append(
                    f"分類「{cell['text']}」が現行行を含むのに将来対応色です"
                )
            if is_current_category and covered and all(covered):
                errors.append(
                    f"分類「{cell['text']}」の全行が将来対応なのに通常色です"
                )

    counts = {}
    for line in function_lines:
        for fr_id in set(re.findall(r"\bFR-\d+\b", line)):
            counts[fr_id] = counts.get(fr_id, 0) + 1
    for fr_id, count in sorted(counts.items()):
        if count >= 4:
            warnings.append(f"{fr_id} が {count} 機能行に分解されています。過分解でないか確認してください")

    question_lines = [line for line in function_lines if "要確認" in line]
    criteria_panel = _panel(html_text, "panel-crit")
    for line in question_lines:
        fr_ids = set(re.findall(r"\bFR-\d+\b", line))
        if not any(fr_id in criteria_panel for fr_id in fr_ids):
            errors.append(
                "業務ルールの要確認事項が成功基準ほかタブに集約されていません: "
                + ", ".join(sorted(fr_ids))
            )

    return errors, warnings


def main():
    parser = argparse.ArgumentParser(description="基本設計HTMLの品質検査")
    parser.add_argument("spec", help="入力 spec.md")
    parser.add_argument("html", help="検査対象の機能一覧.html")
    args = parser.parse_args()

    with open(args.spec, encoding="utf-8") as file:
        spec_text = file.read()
    with open(args.html, encoding="utf-8") as file:
        html_text = file.read()

    errors, warnings = check(spec_text, html_text)
    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
    fr_count = len(set(re.findall(r"FR-\d+", spec_text)))
    print(f"OK: FR {fr_count}件 / 警告 {len(warnings)}件")


if __name__ == "__main__":
    main()
