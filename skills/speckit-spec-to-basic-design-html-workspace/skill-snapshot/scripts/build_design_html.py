# -*- coding: utf-8 -*-
"""Render validated basic-design schema v2 as a self-contained HTML file."""

from __future__ import annotations

import argparse
import html
import json
import sys
from datetime import datetime
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from design_quality import (  # noqa: E402
    TYPE_LABELS,
    flatten_functions,
    normalize_config,
    validate_design,
)


HEADER_BG = "#C6D9F1"
DAI_BG = "#4BACC6"
CHU_BG = "#92CDDC"
SHO_BG = ["#DAEEF3", "#FDE9D9"]
FUTURE_BG = "#EFEFEF"
GRID = "#BFBFBF"

MAIN_HEADERS = [
    "大分類",
    "中分類",
    "小分類",
    "機能ID",
    "機能名",
    "概要",
    "アクター",
    "実行形態",
    "根拠",
    "提供状態",
]


def esc(value):
    if value is None:
        value = ""
    return html.escape(str(value)).replace("\n", "<br>")


def _as_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _fmt_date(value):
    if isinstance(value, str):
        for fmt in ("%Y-%m-%d", "%Y/%m/%d"):
            try:
                parsed = datetime.strptime(value, fmt)
                return f"{parsed.year}年{parsed.month:02d}月{parsed.day:02d}日"
            except ValueError:
                pass
    return value


def _is_future(item):
    return item.get("status") == "future" or any(item.get(k) for k in ("future", "out_v1", "将来"))


def _category_label(category):
    category_id = str(category.get("id", "")).strip()
    badge = f'<span class="idbadge">{esc(category_id)}</span> ' if category_id else ""
    return badge + esc(category.get("name", ""))


def _badges(values, css_class="ref"):
    return " ".join(f'<span class="{css_class}">{esc(v)}</span>' for v in _as_list(values) if str(v).strip())


def _plain_list(values, empty="該当なし"):
    values = [str(v).strip() for v in _as_list(values) if str(v).strip()]
    if not values:
        return f'<span class="muted">{esc(empty)}</span>'
    return "<ul>" + "".join(f"<li>{esc(v)}</li>" for v in values) + "</ul>"


def _execution(function, interfaces):
    execution = function.get("execution") or {}
    kind = execution.get("type", "")
    labels = {
        "screen": "画面",
        "api": "API",
        "batch": "バッチ",
        "event": "イベント",
        "external-interface": "外部連携",
        "manual": "手動運用",
        "cross-cutting": "横断制御",
    }
    refs = []
    for ref in _as_list(execution.get("refs")):
        interface = interfaces.get(str(ref), {})
        refs.append(f"{ref} {interface.get('name', '')}".strip())
    suffix = "<br>" + "<br>".join(esc(v) for v in refs) if refs else ""
    return f'<span class="kind kind-{esc(kind)}">{esc(labels.get(kind, kind))}</span>{suffix}'


def _status(function):
    if _is_future(function):
        return '<span class="status future-tag">将来対応</span>'
    return '<span class="status current-tag">現行</span>'


def _rules(function):
    rules = function.get("business_rules", []) or []
    if not rules:
        return '<span class="muted">該当なし</span>'
    labels = {"specified": "spec記載", "derived": "設計導出", "confirmed": "確認済み"}
    parts = ["<ol class=\"rules\">"]
    for rule in rules:
        if isinstance(rule, str):
            parts.append(f"<li>{esc(rule)}</li>")
            continue
        basis = rule.get("basis", "")
        rationale = rule.get("rationale")
        parts.append(
            "<li>"
            + esc(rule.get("text", ""))
            + f' <span class="basis basis-{esc(basis)}">{esc(labels.get(basis, basis))}</span> '
            + _badges(rule.get("source_refs"))
            + (f'<div class="rationale">導出理由: {esc(rationale)}</div>' if rationale else "")
            + "</li>"
        )
    parts.append("</ol>")
    return "".join(parts)


def _exceptions(function):
    values = function.get("exceptions", []) or []
    if not values:
        return '<span class="muted">該当なし</span>'
    out = ["<ul>"]
    for value in values:
        if isinstance(value, dict):
            text = f"{value.get('condition', '')} → {value.get('behavior', '')}".strip(" →")
            basis = value.get("basis", "")
            labels = {"specified": "spec記載", "derived": "設計導出", "confirmed": "確認済み"}
            rationale = value.get("rationale")
            out.append(
                f'<li>{esc(text)} <span class="basis basis-{esc(basis)}">{esc(labels.get(basis, basis))}</span> '
                f'{_badges(value.get("source_refs"))}'
                + (f'<div class="rationale">導出理由: {esc(rationale)}</div>' if rationale else "")
                + "</li>"
            )
        else:
            out.append(f"<li>{esc(value)}</li>")
    out.append("</ul>")
    return "".join(out)


def _main_rows(cfg, interfaces):
    lines = []
    for major in cfg.get("function_list", []):
        for middle in major.get("children", []):
            for minor_index, minor in enumerate(middle.get("children", [])):
                for function in minor.get("rows", []) or []:
                    # 分類セルを各行へ持たせる。検索で行を非表示にしても分類が欠落しない。
                    cells = [
                        f'<td class="dai">{_category_label(major)}</td>',
                        f'<td class="chu">{_category_label(middle)}</td>',
                        f'<td class="sho{minor_index % 2}">{_category_label(minor)}</td>',
                    ]
                    fid = function.get("id", "")
                    future = " future" if _is_future(function) else ""
                    cells.extend(
                        [
                            f'<td class="c{future}"><a class="fnlink" href="#detail-{esc(fid)}" data-detail="{esc(fid)}">{esc(fid)}</a></td>',
                            f'<td class="g{future}">{esc(function.get("name", ""))}</td>',
                            f'<td class="g{future}">{esc(function.get("summary", ""))}</td>',
                            f'<td class="g{future}">{"<br>".join(esc(v) for v in _as_list(function.get("actors")))}</td>',
                            f'<td class="g{future}">{_execution(function, interfaces)}</td>',
                            f'<td class="g{future}">{_badges(function.get("source_refs"))}</td>',
                            f'<td class="c{future}">{_status(function)}</td>',
                        ]
                    )
                    search = " ".join(
                        [
                            str(fid),
                            str(function.get("name", "")),
                            str(function.get("summary", "")),
                            " ".join(map(str, _as_list(function.get("actors")))),
                            " ".join(map(str, _as_list(function.get("source_refs")))),
                        ]
                    )
                    lines.append(
                        f'<tr data-search="{esc(search.casefold())}" data-status="{esc(function.get("status", ""))}" '
                        f'data-execution="{esc((function.get("execution") or {}).get("type", ""))}">'
                        + "".join(cells)
                        + "</tr>"
                    )
    return lines


def _details(cfg, interfaces):
    out = ['<h2 id="details">機能詳細</h2>']
    for major, middle, minor, function in flatten_functions(cfg):
        fid = function.get("id", "")
        future = " future-card" if _is_future(function) else ""
        out.append(f'<article class="function-card{future}" id="detail-{esc(fid)}">')
        out.append(
            f'<header><span class="fnid">{esc(fid)}</span><h3>{esc(function.get("name", ""))}</h3>{_status(function)}</header>'
        )
        out.append(
            f'<p class="breadcrumb">{_category_label(major)} ／ {_category_label(middle)} ／ {_category_label(minor)}</p>'
        )
        out.append(f'<p class="summary">{esc(function.get("summary", ""))}</p>')
        out.append('<dl class="detail-grid">')
        entries = [
            ("アクター", "<br>".join(esc(v) for v in _as_list(function.get("actors")))),
            ("起動契機", esc(function.get("trigger", ""))),
            ("実行形態", _execution(function, interfaces)),
            ("入力", _plain_list(function.get("inputs"))),
            ("出力", _plain_list(function.get("outputs"))),
            ("事前条件", _plain_list(function.get("preconditions"))),
            ("事後状態", _plain_list(function.get("postconditions"))),
            ("業務ルール", _rules(function)),
            ("例外・失敗時", _exceptions(function)),
            ("対象データ", _plain_list(function.get("data_entities"))),
            ("根拠", _badges(function.get("source_refs"))),
        ]
        for label, value in entries:
            out.append(f"<dt>{esc(label)}</dt><dd>{value}</dd>")
        out.append("</dl></article>")
    return out


def _traceability(cfg, item_by_id):
    out = ['<h2 id="traceability">トレーサビリティ</h2>', '<table class="aux"><caption>spec規範要素と機能の対応</caption>']
    out.append(
        "<thead><tr>"
        + "".join(f'<th scope="col">{h}</th>' for h in ("根拠ID", "種別", "spec記載", "機能ID", "カバレッジ", "理由"))
        + "</tr></thead><tbody>"
    )
    for entry in cfg.get("traceability", []) or []:
        source_id = entry.get("source_id", "")
        item = item_by_id.get(source_id, {})
        coverage = entry.get("coverage", "")
        funcs = " ".join(
            f'<a class="fnlink" href="#detail-{esc(fid)}" data-detail="{esc(fid)}">{esc(fid)}</a>'
            for fid in _as_list(entry.get("function_ids"))
        ) or '<span class="muted">—</span>'
        out.append(
            "<tr>"
            f'<td class="c">{_badges([source_id])}</td>'
            f'<td>{esc(TYPE_LABELS.get(item.get("type"), item.get("type", "")))}</td>'
            f'<td>{esc(item.get("text", entry.get("summary", "")))}</td>'
            f"<td>{funcs}</td>"
            f'<td class="c"><span class="coverage coverage-{esc(coverage)}">{esc(coverage)}</span></td>'
            f'<td>{esc(entry.get("rationale", ""))}</td>'
            "</tr>"
        )
    out.append("</tbody></table>")
    return out


def _interfaces(cfg):
    out = ['<h2 id="interfaces">インターフェース</h2>', '<table class="aux"><caption>機能の実行接点</caption>']
    out.append(
        "<thead><tr>"
        + "".join(f'<th scope="col">{h}</th>' for h in ("ID", "種別", "名称", "概要", "アクター", "状態"))
        + "</tr></thead><tbody>"
    )
    for interface in cfg.get("interfaces", []) or []:
        out.append(
            "<tr>"
            f'<td class="c">{esc(interface.get("id", ""))}</td>'
            f'<td class="c">{esc(interface.get("type", ""))}</td>'
            f'<td>{esc(interface.get("name", ""))}</td>'
            f'<td>{esc(interface.get("summary", ""))}</td>'
            f'<td>{"<br>".join(esc(v) for v in _as_list(interface.get("actors")))}</td>'
            f'<td class="c">{_status(interface)}</td>'
            "</tr>"
        )
    out.append("</tbody></table>")
    return out


def _quality(cfg, report):
    out = ['<h2 id="quality">確認・品質情報</h2>', '<div class="quality-summary">']
    cards = [
        ("判定", report.get("status", "draft")),
        ("ブロッキング", report.get("blocking_error_count", 0)),
        ("警告", report.get("warning_count", 0)),
        ("未解決", report.get("unresolved_count", 0)),
        ("根拠なし", report.get("unsubstantiated_count", 0)),
    ]
    for label, value in cards:
        out.append(f'<div class="quality-card"><span>{esc(label)}</span><strong>{esc(value)}</strong></div>')
    out.append("</div>")
    out.append('<h3>規範要素カバレッジ</h3><table class="aux compact"><caption>種別ごとの要求網羅率</caption>')
    out.append('<thead><tr><th scope="col">種別</th><th scope="col">解決</th><th scope="col">総数</th><th scope="col">網羅率</th></tr></thead><tbody>')
    for kind, values in (report.get("coverage") or {}).items():
        out.append(
            f'<tr><td>{esc(TYPE_LABELS.get(kind, kind))}</td><td class="c">{esc(values.get("resolved", 0))}</td>'
            f'<td class="c">{esc(values.get("total", 0))}</td><td class="c">{esc(values.get("percent", 0))}%</td></tr>'
        )
    out.append("</tbody></table>")
    for key, heading in (("errors", "ブロッキングエラー"), ("warnings", "警告")):
        out.append(f"<h3>{heading}</h3>{_plain_list(report.get(key), 'なし')}")
    pending_questions = [
        f"[{q.get('status', 'open')}] {q.get('question', '')}"
        for q in cfg.get("open_questions", [])
        if q.get("status", "open") != "resolved"
    ]
    out.append(f'<h3>ユーザー確認待ち</h3>{_plain_list(pending_questions, "なし")}')
    decisions = [f"{d.get('id', '')}: {d.get('question', '')} → {d.get('answer', '')}" for d in cfg.get("decisions", [])]
    out.append(f'<h3>確認済み決定</h3>{_plain_list(decisions, "なし")}')
    return out


CSS = """
:root{--grid:%(grid)s;--hdr:%(hdr)s;--dai:%(dai)s;--chu:%(chu)s;--sho0:%(sho0)s;--sho1:%(sho1)s;--future:%(future)s;}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{font-family:"游ゴシック","Yu Gothic",YuGothic,Meiryo,sans-serif;font-size:13px;color:#222;margin:0;padding:24px;background:#fff;line-height:1.5}
.titlebar{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:4px 0 16px;flex-wrap:wrap}.title{font-size:26px;font-weight:700;margin:0;letter-spacing:.04em}table.meta{border-collapse:collapse;font-size:12px;width:auto}table.meta td{border:1px solid var(--grid);padding:3px 10px;white-space:nowrap}table.meta td.k{background:var(--hdr);text-align:center}
h2{font-size:17px;margin:6px 0 10px;padding-left:8px;border-left:6px solid var(--dai)}h3{font-size:14px;margin:18px 0 7px}table{border-collapse:collapse;width:100%%;table-layout:fixed}caption{font-weight:700;text-align:left;margin:0 0 6px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
th,td{border:1px solid var(--grid);padding:5px 7px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}thead th{background:var(--hdr);text-align:center;vertical-align:middle;position:sticky;top:46px;z-index:2}td.c{text-align:center}td.dai,td.chu,td.sho0,td.sho1{vertical-align:middle;font-weight:600}td.dai{background:var(--dai)}td.chu{background:var(--chu)}td.sho0{background:var(--sho0)}td.sho1{background:var(--sho1)}td.g{background:#fff}td.future,.future-card{background:var(--future);color:#666}.muted{color:#888}.idbadge,.fnid,.ref{font-size:11px;font-weight:700;background:#edf4f7;border:1px solid #c7dde5;border-radius:3px;padding:1px 4px;white-space:nowrap}.fnlink{color:#12677d;font-weight:700}.status,.kind,.basis,.coverage{display:inline-block;font-size:11px;font-weight:700;border-radius:10px;padding:1px 7px;white-space:nowrap}.current-tag{background:#e5f4ea;color:#27643a}.future-tag{background:#fdeccb;color:#805300}.kind{background:#eaf1f8;color:#315c7b}.basis-specified{background:#e8f3fb;color:#245d83}.basis-derived{background:#fff1da;color:#805300}.basis-confirmed{background:#e5f4ea;color:#27643a}.coverage-covered{background:#e5f4ea}.coverage-partial,.coverage-unresolved{background:#fde5e5;color:#8b2929}.coverage-future{background:#fdeccb}.coverage-out-of-scope{background:#eee;color:#555}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.toolbar label{font-size:12px;font-weight:600}.toolbar input,.toolbar select{font:inherit;border:1px solid #aebbc4;border-radius:4px;padding:5px 8px;background:#fff}.funclist th:nth-child(1),.funclist th:nth-child(2),.funclist th:nth-child(3){width:7%%}.funclist th:nth-child(4){width:6%%}.funclist th:nth-child(5){width:10%%}.funclist th:nth-child(6){width:19%%}.funclist th:nth-child(7){width:8%%}.funclist th:nth-child(8){width:10%%}.funclist th:nth-child(9){width:12%%}.funclist th:nth-child(10){width:7%%}
.function-card{border:1px solid var(--grid);border-left:5px solid var(--dai);border-radius:4px;margin:0 0 14px;padding:12px;background:#fff}.function-card header{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.function-card h3{font-size:16px;margin:0}.breadcrumb{font-size:12px;color:#567;margin:6px 0}.summary{font-weight:600}.detail-grid{display:grid;grid-template-columns:130px minmax(0,1fr);margin:0;border-top:1px solid var(--grid);border-left:1px solid var(--grid)}.detail-grid dt,.detail-grid dd{margin:0;padding:6px 8px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid)}.detail-grid dt{background:#eef5f7;font-weight:700}.detail-grid ul,.rules{margin:0;padding-left:20px}.rationale{font-size:12px;color:#66512b;margin-top:2px}
.aux th:nth-child(1){width:11%%}.aux th:nth-child(2){width:13%%}.aux th:nth-child(4){width:15%%}.aux th:nth-child(5){width:12%%}.compact{max-width:720px}.quality-summary{display:flex;gap:8px;flex-wrap:wrap}.quality-card{border:1px solid var(--grid);border-top:4px solid var(--dai);min-width:130px;padding:8px 12px}.quality-card span{display:block;font-size:11px;color:#667}.quality-card strong{font-size:20px}.panel{display:none}.panel.active{display:block}.tabbar{position:sticky;top:0;z-index:6;display:flex;gap:4px;align-items:flex-end;background:#fff;border-bottom:2px solid var(--dai);padding:6px 0 0;margin:0 0 12px;overflow-x:auto;min-height:40px}.tabbar button{font:inherit;font-size:13px;border:1px solid #d4dde4;border-bottom:none;background:#eef2f5;color:#456;padding:7px 18px;border-radius:6px 6px 0 0;cursor:pointer;white-space:nowrap}.tabbar button:hover,.tabbar button:focus{background:#e3eaef}.tabbar button.active{background:var(--dai);color:#fff;font-weight:700;border-color:var(--dai)}
@media(max-width:900px){body{padding:12px}.funclist{min-width:1100px}.panel{overflow-x:auto}.detail-grid{grid-template-columns:100px minmax(0,1fr)}}@media print{body{padding:0;font-size:10px}thead th{position:static}tr,.function-card{break-inside:avoid}thead{display:table-header-group}.tabbar,.toolbar{display:none}.panel{display:block!important}.panel+.panel{page-break-before:always}}
""".strip()


SCRIPT = """
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('[role="tab"]'));
  var panels=[].slice.call(document.querySelectorAll('[role="tabpanel"]'));
  function show(id,focus){panels.forEach(function(p){p.classList.toggle('active',p.id===id);});tabs.forEach(function(t){var on=t.getAttribute('aria-controls')===id;t.classList.toggle('active',on);t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});if(focus){var tab=tabs.find(function(t){return t.getAttribute('aria-controls')===id;});if(tab){tab.focus();}}}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){show(t.getAttribute('aria-controls'));});t.addEventListener('keydown',function(e){var n=i;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();show(tabs[n].getAttribute('aria-controls'),true);});});
  document.querySelectorAll('[data-detail]').forEach(function(a){a.addEventListener('click',function(){show('panel-details');setTimeout(function(){var el=document.getElementById('detail-'+a.dataset.detail);if(el)el.scrollIntoView();},0);});});
  var query=document.getElementById('filter-query'),status=document.getElementById('filter-status'),execution=document.getElementById('filter-execution');function filter(){var q=(query.value||'').toLowerCase();document.querySelectorAll('#function-body tr').forEach(function(row){var ok=(!q||row.dataset.search.indexOf(q)>=0)&&(!status.value||row.dataset.status===status.value)&&(!execution.value||row.dataset.execution===execution.value);row.hidden=!ok;});}[query,status,execution].forEach(function(el){el.addEventListener('input',filter);});
  if(window.location.hash.indexOf('#detail-FNC-')===0){show('panel-details');}
})();
</script>
""".strip()


def render(config, spec_text=None, allow_draft=True):
    cfg = normalize_config(config)
    items = []
    if spec_text is not None:
        cfg, report, items = validate_design(spec_text, config)
        if report["errors"] and not allow_draft:
            raise ValueError("設計品質ゲートに失敗しました:\n- " + "\n- ".join(report["errors"]))
    else:
        report = cfg.get("quality") or {
            "status": "draft",
            "blocking_error_count": 0,
            "warning_count": 1,
            "unresolved_count": len(cfg.get("open_questions", [])),
            "unsubstantiated_count": sum(1 for _, _, _, f in flatten_functions(cfg) if not f.get("source_refs")),
            "coverage": {},
            "errors": [],
            "warnings": ["spec.md未指定のため要求網羅性は未検証です"],
        }
    item_by_id = {item["id"]: item for item in items}
    interfaces = {str(i.get("id")): i for i in cfg.get("interfaces", []) or []}
    title = cfg.get("title", "機能一覧")
    meta = cfg.get("meta", {}) or {}

    main = [
        '<h2 id="functions">機能一覧</h2>',
        '<div class="toolbar" aria-label="機能一覧の絞り込み">',
        '<label>検索 <input id="filter-query" type="search" placeholder="ID・名称・根拠"></label>',
        '<label>状態 <select id="filter-status"><option value="">すべて</option><option value="current">現行</option><option value="future">将来</option></select></label>',
        '<label>実行形態 <select id="filter-execution"><option value="">すべて</option>'
        + "".join(f'<option value="{v}">{v}</option>' for v in ("screen", "api", "batch", "event", "external-interface", "manual", "cross-cutting"))
        + "</select></label></div>",
        '<table class="funclist"><caption class="sr-only">基本設計 機能一覧</caption>',
        "<thead><tr>" + "".join(f'<th scope="col">{esc(h)}</th>' for h in MAIN_HEADERS) + "</tr></thead>",
        '<tbody id="function-body">',
        *_main_rows(cfg, interfaces),
        "</tbody></table>",
    ]
    sheets = [
        ("functions", "機能一覧", main),
        ("details", "機能詳細", _details(cfg, interfaces)),
        ("traceability", "トレーサビリティ", _traceability(cfg, item_by_id)),
        ("interfaces", "インターフェース", _interfaces(cfg)),
        ("quality", "確認・品質情報", _quality(cfg, report)),
    ]

    css = CSS % {"grid": GRID, "hdr": HEADER_BG, "dai": DAI_BG, "chu": CHU_BG, "sho0": SHO_BG[0], "sho1": SHO_BG[1], "future": FUTURE_BG}
    out = [
        "<!DOCTYPE html>",
        '<html lang="ja">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{esc(title)}</title>",
        f"<style>{css}</style>",
        "</head>",
        "<body>",
        '<div class="titlebar">',
        f'<h1 class="title">{esc(title)}</h1>',
    ]
    meta_rows = []
    for key in ("作成日", "作成者", "更新日", "更新者"):
        value = _fmt_date(meta.get(key, "")) if key in ("作成日", "更新日") else meta.get(key, "")
        meta_rows.append(f'<tr><td class="k">{esc(key)}</td><td>{esc(value)}</td></tr>')
    out.extend(['<table class="meta"><caption class="sr-only">文書情報</caption>' + "".join(meta_rows) + "</table>", "</div>"])
    out.append('<nav class="tabbar" role="tablist" aria-label="設計書シート">')
    for index, (key, label, _) in enumerate(sheets):
        active = " active" if index == 0 else ""
        selected = "true" if index == 0 else "false"
        tabindex = "0" if index == 0 else "-1"
        out.append(f'<button type="button" role="tab" class="{active.strip()}" id="tab-{key}" aria-controls="panel-{key}" aria-selected="{selected}" tabindex="{tabindex}">{esc(label)}</button>')
    out.append("</nav>")
    for index, (key, _, lines) in enumerate(sheets):
        active = " active" if index == 0 else ""
        out.append(f'<section class="panel{active}" id="panel-{key}" role="tabpanel" aria-labelledby="tab-{key}">')
        out.extend(lines)
        out.append("</section>")
    out.extend([SCRIPT, "</body>", "</html>", ""])
    return "\n".join(out), report


def _output_path(cfg, config_path, override):
    if override:
        return Path(override)
    configured = cfg.get("output_html") or cfg.get("output")
    if configured:
        path = Path(configured)
        if path.name.endswith(".design.json"):
            return path.with_name(path.name[: -len(".design.json")] + ".html")
        return path.with_suffix(".html")
    name = config_path.name
    if name.endswith(".design.json"):
        return config_path.with_name(name[: -len(".design.json")] + ".html")
    return config_path.with_suffix(".html")


def main():
    parser = argparse.ArgumentParser(description="検証済み基本設計データから自己完結HTMLを生成")
    parser.add_argument("config", help="v2設計データ (*.design.json)")
    parser.add_argument("--spec", help="要求の正本 spec.md。確定版生成では必須")
    parser.add_argument("-o", "--output", help="出力HTML")
    parser.add_argument("--allow-draft", action="store_true", help="品質エラーがあってもレビュー用ドラフトを生成")
    args = parser.parse_args()

    config_path = Path(args.config)
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    spec_path = Path(args.spec) if args.spec else None
    if spec_path is None:
        configured_spec = str((cfg.get("source") or {}).get("spec", "")).strip()
        if configured_spec:
            candidate = Path(configured_spec)
            if not candidate.exists():
                candidate = config_path.parent / configured_spec
            if candidate.exists():
                spec_path = candidate
    if cfg.get("schema_version") == 2 and spec_path is None and not args.allow_draft:
        parser.error("確定版生成には --spec が必要です。未検証出力は --allow-draft を明示してください")
    spec_text = spec_path.read_text(encoding="utf-8") if spec_path else None
    try:
        html_text, report = render(cfg, spec_text, allow_draft=args.allow_draft)
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")
    output = _output_path(cfg, config_path, args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html_text, encoding="utf-8")
    count = len(flatten_functions(normalize_config(cfg)))
    print(f"saved {output} (機能 {count}件 / 品質 {report['status']} / 警告 {report['warning_count']}件)")


if __name__ == "__main__":
    main()
