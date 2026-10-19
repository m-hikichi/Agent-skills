# -*- coding: utf-8 -*-
"""Validate design schema v2/v3 against Spec Kit artifacts and rendered HTML."""

from __future__ import annotations

import argparse
import copy
import hashlib
import inspect
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

REQUIRED_V3_PANELS = {
    "panel-review",
    "panel-functions",
    "panel-details",
    "panel-quality",
    "panel-traceability",
}

OPTIONAL_V3_PANELS = {
    "architecture": "panel-architecture",
    "entities": "panel-data",
    "interfaces": "panel-interfaces",
    "delivery_summary": "panel-delivery",
}


def _v3_panel_has_data(cfg, key):
    value = cfg.get(key)
    if key == "architecture":
        value = value if isinstance(value, dict) else {}
        return any(
            value.get(name)
            for name in (
                "context",
                "system_context",
                "containers",
                "container",
                "components",
                "component",
                "code",
                "decisions",
                "deployment",
                "observability",
                "recovery",
            )
        )
    return bool(value)


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


def check_html_structure(html_text, require_v2=False, require_v3=False, config=None):
    errors = []
    warnings = []
    if re.search(r"\sstyle\s*=", html_text, re.IGNORECASE):
        errors.append("style属性が含まれています")
    if re.search(r'<(?:link|script|img)\b[^>]*(?:src|href)=["\']https?://', html_text, re.I):
        errors.append("外部アセットURLが含まれています")
    if re.search(r"@import\s+url\s*\(\s*[\"']?https?://|\b(?:fetch|XMLHttpRequest)\s*\(", html_text, re.I):
        errors.append("実行時の外部network依存が含まれています")
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
    if require_v3:
        required = set(REQUIRED_V3_PANELS)
        cfg = config or {}
        for key, panel in OPTIONAL_V3_PANELS.items():
            if _v3_panel_has_data(cfg, key):
                required.add(panel)
        if cfg.get("workflows") or cfg.get("state_models"):
            required.add("panel-flows")
        missing = [panel for panel in sorted(required) if f'id="{panel}"' not in html_text]
        if missing:
            errors.append("v3必須パネルがありません: " + ", ".join(missing))
        optional_pairs = list(OPTIONAL_V3_PANELS.items()) + [("flows", "panel-flows")]
        for key, panel in optional_pairs:
            has_data = (
                bool(cfg.get("workflows") or cfg.get("state_models"))
                if key == "flows"
                else _v3_panel_has_data(cfg, key)
            )
            if not has_data and f'id="{panel}"' in html_text:
                errors.append(f"データのない任意パネルが表示されています: {panel}")
        if 'role="tablist"' not in html_text or 'role="tab"' not in html_text or "aria-controls=" not in html_text:
            errors.append("タブのアクセシビリティ属性が不足しています")
        if "<caption" not in html_text or 'scope="col"' not in html_text or 'scope="row"' not in html_text:
            errors.append("表のcaptionまたは列・行見出しscopeが不足しています")
        if "<svg" in html_text:
            svg_tags = re.findall(r"<svg\b[^>]*>", html_text, re.I)
            if any('role="img"' not in tag or "aria-labelledby=" not in tag for tag in svg_tags):
                errors.append("図のrole=imgまたはaria-labelledbyが不足しています")
            svg_blocks = re.findall(r"<svg\b[^>]*>.*?</svg>", html_text, re.I | re.S)
            if any(not re.search(r"<title\b", block, re.I) for block in svg_blocks):
                errors.append("図のtitleが不足しています")
            if any(not re.search(r"<desc\b", block, re.I) for block in svg_blocks):
                errors.append("図のdescが不足しています")
            if html_text.count('class="aux diagram-table"') < len(svg_blocks):
                errors.append("SVG図と同内容を確認できるHTML表が不足しています")
        expected_functions = {row[3].get("id") for row in _flatten_functions(cfg) if row[3].get("id")}
        rendered_functions = set(re.findall(r'id="detail-(FNC-\d{3,})"', html_text))
        if expected_functions != rendered_functions:
            missing_ids = expected_functions - rendered_functions
            extra_ids = rendered_functions - expected_functions
            if missing_ids:
                errors.append("HTMLに無い機能詳細: " + ", ".join(sorted(missing_ids)))
            if extra_ids:
                errors.append("JSONに無い機能詳細: " + ", ".join(sorted(extra_ids)))
        id_values = re.findall(r'\bid="([^"]+)"', html_text)
        duplicate_ids = sorted({value for value in id_values if id_values.count(value) > 1})
        if duplicate_ids:
            errors.append("HTML内のidが重複しています: " + ", ".join(duplicate_ids))
        internal_links = set(re.findall(r'\bhref="#([^"]+)"', html_text))
        dangling_links = sorted(internal_links - set(id_values))
        if dangling_links:
            errors.append("ページ内リンク先がありません: " + ", ".join(dangling_links))
    return errors, warnings


def _flatten_functions(cfg):
    for major in cfg.get("function_list", []) or []:
        for middle in major.get("children", []) or []:
            for minor in middle.get("children", []) or []:
                for function in minor.get("rows", []) or []:
                    yield major, middle, minor, function


def _resolve_source(source):
    source_path = Path(source)
    if source_path.is_dir():
        feature_dir = source_path
        spec_path = feature_dir / "spec.md"
    else:
        spec_path = source_path
        feature_dir = source_path.parent
    return spec_path, feature_dir


def _artifact_entries(cfg):
    source = cfg.get("source") or {}
    entries = source.get("artifacts") or []
    return entries if isinstance(entries, list) else []


def _artifact_path(feature_dir, entry):
    path = Path(str(entry.get("path", "")))
    return path if path.is_absolute() else feature_dir / path


def _validate_artifact_files(cfg, feature_dir):
    errors = []
    root = Path(feature_dir).resolve()
    seen_paths = set()
    has_spec = False
    for index, entry in enumerate(_artifact_entries(cfg), 1):
        if not isinstance(entry, dict) or not str(entry.get("type", "")).strip():
            errors.append(f"source.artifacts[{index}]のtypeがありません")
            continue
        artifact_type = str(entry.get("type", "")).strip().casefold()
        has_spec = has_spec or artifact_type == "spec"
        if not str(entry.get("path", "")).strip():
            errors.append(f"source.artifacts[{index}]のpathがありません")
            continue
        relative_path = Path(str(entry["path"]))
        if relative_path.is_absolute():
            errors.append(f"source.artifacts[{index}]のpathはfeatureディレクトリ相対で指定してください")
            continue
        path = _artifact_path(feature_dir, entry)
        try:
            resolved = path.resolve()
            resolved.relative_to(root)
        except ValueError:
            errors.append(f"入力成果物がfeatureディレクトリ外を参照しています: {entry.get('path')}")
            continue
        normalized_path = str(relative_path).replace("\\", "/").casefold()
        if normalized_path in seen_paths:
            errors.append(f"入力成果物pathが重複しています: {entry.get('path')}")
        seen_paths.add(normalized_path)
        if not path.is_file():
            errors.append(f"入力成果物が見つかりません: {entry.get('path')}")
            continue
        if not entry.get("locator") and not entry.get("sections") and not entry.get("headings"):
            errors.append(f"source.artifacts[{index}]のlocatorがありません")
        fingerprint = str(entry.get("fingerprint", "")).removeprefix("sha256:").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", fingerprint):
            errors.append(f"source.artifacts[{index}]のfingerprintは64桁SHA-256ではありません")
        elif hashlib.sha256(path.read_bytes()).hexdigest() != fingerprint:
            errors.append(f"入力成果物のfingerprintが一致しません: {entry.get('path')}")
    if not has_spec:
        errors.append("source.artifactsにtype=specがありません")
    return errors


def _with_artifact_fingerprints(cfg, feature_dir):
    updated = copy.deepcopy(cfg)
    root = Path(feature_dir).resolve()
    entries = ((updated.get("source") or {}).get("artifacts") or [])
    for entry in entries:
        if not isinstance(entry, dict) or not entry.get("path"):
            continue
        path = _artifact_path(feature_dir, entry)
        try:
            path.resolve().relative_to(root)
        except ValueError:
            continue
        existing = str(entry.get("fingerprint", "")).strip().casefold()
        needs_initialization = (
            not existing
            or existing in {"auto", "pending", "undetermined"}
            or existing == "0" * 64
        )
        if (
            needs_initialization
            and not Path(str(entry["path"])).is_absolute()
            and path.is_file()
        ):
            entry["fingerprint"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return updated


def _sync_requirement_decisions(cfg, items):
    """Expose existing spec Clarifications in the review view without duplicating truth."""
    updated = copy.deepcopy(cfg)
    existing = {
        item.get("id"): item
        for item in (updated.get("requirement_decisions") or updated.get("decisions") or [])
        if isinstance(item, dict) and item.get("id")
    }
    for item in items:
        if item.get("type") != "clarification":
            continue
        text = str(item.get("text", ""))
        match = re.search(r"(?:^|\s)Q[:：]\s*(.*?)\s*(?:→|->|⇒)\s*A[:：]\s*(.*)$", text)
        question, answer = (match.group(1), match.group(2)) if match else (text, "")
        existing[item["id"]] = {
            "id": item["id"],
            "question": question,
            "answer": answer,
            "source_locator": item.get("locator", "spec.md > Clarifications"),
        }
    updated["requirement_decisions"] = list(existing.values())
    return updated


def _call_validate(spec_text, cfg, feature_dir, level):
    kwargs = {}
    parameters = inspect.signature(validate_design).parameters
    if "feature_dir" in parameters:
        kwargs["feature_dir"] = feature_dir
    if "level" in parameters:
        kwargs["level"] = level
    return validate_design(spec_text, cfg, **kwargs)


def check_html_freshness(spec_text, cfg, html_text, feature_dir=None, level="auto"):
    """Regenerate in memory and reject stale or manually edited derived HTML."""
    from build_design_html import render

    parameters = inspect.signature(render).parameters
    kwargs = {"allow_draft": True}
    if "level" in parameters:
        kwargs["level"] = level
    if "feature_dir" in parameters:
        kwargs["feature_dir"] = feature_dir
    expected, _ = render(copy.deepcopy(cfg), spec_text, **kwargs)
    return [] if expected == html_text else ["HTMLがdesign.jsonの再生成結果と一致しません（古い、または直接編集されています）"]


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


def _write_quality(path, cfg, report, items, feature_dir):
    updated = _with_artifact_fingerprints(cfg, feature_dir)
    updated = _sync_requirement_decisions(updated, items)
    if updated.get("schema_version") == 3:
        updated["report"] = report
        updated.pop("quality", None)
    else:
        updated["quality"] = report
    updated["source_catalog"] = build_source_catalog(items)
    path.write_text(json.dumps(updated, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _merge_report_findings(report, errors, warnings):
    """Keep persisted readiness truthful when HTML/file checks add findings."""
    updated = copy.deepcopy(report)
    errors = list(dict.fromkeys(errors))
    warnings = list(dict.fromkeys(warnings))
    readiness = updated.get("readiness") or {}
    axis_errors = {
        error
        for entry in readiness.values()
        if isinstance(entry, dict)
        for error in entry.get("errors", []) or []
    }
    axis_warnings = {
        warning
        for entry in readiness.values()
        if isinstance(entry, dict)
        for warning in entry.get("warnings", []) or []
    }
    extra_errors = [error for error in errors if error not in axis_errors]
    extra_warnings = [warning for warning in warnings if warning not in axis_warnings]
    if readiness and (extra_errors or extra_warnings):
        axis = readiness.setdefault("functional_design", {})
        merged_errors = list(dict.fromkeys([*(axis.get("errors", []) or []), *extra_errors]))
        merged_warnings = list(dict.fromkeys([*(axis.get("warnings", []) or []), *extra_warnings]))
        axis["errors"] = merged_errors
        axis["warnings"] = merged_warnings
        axis["blocking_error_count"] = len(merged_errors)
        axis["warning_count"] = len(merged_warnings)
        if merged_errors:
            axis["status"] = "failed"
    updated["errors"] = errors
    updated["warnings"] = warnings
    updated["blocking_error_count"] = len(errors)
    updated["warning_count"] = len(warnings)
    if errors:
        updated["status"] = "failed"
        updated["document_status"] = "blocked"
    return updated


def _resolve_input_path(value, feature_dir):
    path = Path(value)
    if path.is_absolute():
        return path
    feature_candidate = Path(feature_dir) / path
    return feature_candidate if feature_candidate.exists() else path


def main():
    parser = argparse.ArgumentParser(description="spec.mdと基本設計成果物の品質検査")
    parser.add_argument("source", help="spec.md、またはSpec Kit featureディレクトリ")
    parser.add_argument("design", help="v2/v3 *.design.json、または互換検査対象の旧HTML")
    parser.add_argument("html", nargs="?", help="JSONから生成したHTML（任意）")
    parser.add_argument("--level", choices=("auto", "functional-design", "implementation-ready"), default="auto")
    parser.add_argument("--write-report", action="store_true", help="品質・準備度と入力fingerprintをJSONへ保存")
    args = parser.parse_args()

    spec_path, feature_dir = _resolve_source(args.source)
    if not spec_path.is_file():
        parser.error(f"spec.mdが見つかりません: {spec_path}")
    spec_text = spec_path.read_text(encoding="utf-8")
    design_path = _resolve_input_path(args.design, feature_dir)
    if not design_path.is_file():
        parser.error(f"設計成果物が見つかりません: {design_path}")
    if design_path.suffix.lower() == ".json":
        cfg = json.loads(design_path.read_text(encoding="utf-8"))
        if args.write_report and cfg.get("schema_version") == 3:
            preliminary_items = extract_normative_items(spec_text, cfg.get("source_catalog"))
            cfg = _with_artifact_fingerprints(cfg, feature_dir)
            cfg = _sync_requirement_decisions(cfg, preliminary_items)
        level = args.level if args.level != "auto" else cfg.get("document_level", "functional-design")
        validated_cfg, report, items = _call_validate(spec_text, cfg, feature_dir, level)
        errors = list(report["errors"])
        warnings = list(report["warnings"])
        if cfg.get("schema_version") == 3:
            errors.extend(_validate_artifact_files(cfg, feature_dir))
        if args.html:
            html_path = _resolve_input_path(args.html, feature_dir)
            if not html_path.is_file():
                parser.error(f"HTMLが見つかりません: {html_path}")
            html_text = html_path.read_text(encoding="utf-8")
            html_errors, html_warnings = check_html_structure(
                html_text,
                require_v2=cfg.get("schema_version") == 2,
                require_v3=cfg.get("schema_version") == 3,
                config=cfg,
            )
            errors.extend(html_errors)
            warnings.extend(html_warnings)
            errors.extend(check_html_freshness(spec_text, validated_cfg, html_text, feature_dir, level))
        if args.write_report:
            if cfg.get("schema_version") not in {2, 3}:
                errors.append("旧形式へ品質レポートは書き込めません。先にv3へ移行してください")
            else:
                report = _merge_report_findings(report, errors, warnings)
                if cfg.get("schema_version") == 2:
                    report["status"] = "passed" if not errors else "failed"
                _write_quality(design_path, validated_cfg, report, items, feature_dir)
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
