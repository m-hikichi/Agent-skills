# -*- coding: utf-8 -*-
"""Render validated basic-design schema v2/v3 as a self-contained HTML file."""

from __future__ import annotations

import argparse
import copy
import html
import json
import re
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

READINESS_LABELS = {
    "requirements_coverage": "要求網羅性",
    "functional_design": "機能設計",
    "implementation_contracts": "実装契約",
    "operational_readiness": "運用準備",
}

DOCUMENT_LEVEL_LABELS = {
    "functional-design": "機能設計",
    "implementation-ready": "実装準備",
}


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


def _anchor_token(value):
    return re.sub(r"[^A-Za-z0-9_-]+", "-", str(value)).strip("-") or "item"


def _design_anchor(kind, value):
    aliases = {"state": "state-model", "quality": "quality-scenario"}
    normalized_kind = aliases.get(str(kind).casefold(), str(kind).casefold())
    return f"design-{_anchor_token(normalized_kind)}-{_anchor_token(value)}"


def _reference_anchor(value):
    text = str(value or "").strip()
    upper = text.upper()
    normative = re.fullmatch(r"(?:FR|SC|US|AC|EC|ASM|OOS|CL)-[A-Z0-9-]+", upper)
    if normative:
        return f"source-{_anchor_token(upper)}"
    if ":" in text:
        prefix, target = text.split(":", 1)
        if prefix.casefold() == "spec" and re.fullmatch(
            r"(?:FR|SC|US|AC|EC|ASM|OOS|CL)-[A-Z0-9-]+", target.upper()
        ):
            return f"source-{_anchor_token(target.upper())}"
        if prefix.casefold() in {
            "workflow",
            "state-model",
            "state",
            "entity",
            "interface",
            "quality-scenario",
            "quality",
            "risk",
            "architecture",
        }:
            return _design_anchor(prefix, target)
    for pattern, kind in (
        (r"FNC-[A-Z0-9-]+", "function"),
        (r"WF-[A-Z0-9-]+", "workflow"),
        (r"STM-[A-Z0-9-]+", "state-model"),
        (r"ENT-[A-Z0-9-]+", "entity"),
        (r"(?:API|EVT|BAT|EXT|SCR|MAN)-[A-Z0-9-]+", "interface"),
        (r"QS-[A-Z0-9-]+", "quality-scenario"),
        (r"RSK-[A-Z0-9-]+", "risk"),
        (r"VER-[A-Z0-9-]+", "verification"),
    ):
        if re.fullmatch(pattern, upper):
            if kind == "function":
                return f"detail-{_anchor_token(upper)}"
            if kind == "verification":
                return f"verification-{_anchor_token(upper)}"
            return _design_anchor(kind, upper)
    return ""


def _badges(values, css_class="ref"):
    badges = []
    for value in _as_list(values):
        if not str(value).strip():
            continue
        anchor = _reference_anchor(value)
        if anchor:
            badges.append(
                f'<a class="{css_class} ref-link" href="#{esc(anchor)}">{esc(value)}</a>'
            )
        else:
            badges.append(f'<span class="{css_class}">{esc(value)}</span>')
    return " ".join(badges)


def _plain_list(values, empty="該当なし"):
    values = [str(v).strip() for v in _as_list(values) if str(v).strip()]
    if not values:
        return f'<span class="muted">{esc(empty)}</span>'
    return "<ul>" + "".join(f"<li>{esc(v)}</li>" for v in values) + "</ul>"


def _source_refs(value):
    """Return source refs from either an evidence object or a plain design object."""
    if not isinstance(value, dict):
        return []
    refs = value.get("source_refs") or value.get("sources") or []
    return [str(ref) for ref in _as_list(refs) if str(ref).strip()]


def _evidence(value, empty="未確定"):
    """Render a scalar/list while retaining v3 basis and source provenance."""
    if value is None or value == "" or value == []:
        return f'<span class="muted">{esc(empty)}</span>'
    if isinstance(value, list):
        return "<ul>" + "".join(f"<li>{_evidence(item, empty)}</li>" for item in value) + "</ul>"
    if not isinstance(value, dict):
        return esc(value)

    main = next(
        (
            value.get(key)
            for key in ("value", "text", "name", "description", "summary", "action", "condition")
            if value.get(key) not in (None, "")
        ),
        "",
    )
    basis = value.get("basis", "")
    basis_labels = {"specified": "spec記載", "derived": "設計導出", "confirmed": "確認済み"}
    parts = [esc(main)] if main != "" else []
    if basis:
        parts.append(f'<span class="basis basis-{esc(basis)}">{esc(basis_labels.get(basis, basis))}</span>')
    refs = _source_refs(value)
    if refs:
        parts.append(_badges(refs))
    if value.get("rationale"):
        parts.append(f'<span class="rationale">導出理由: {esc(value.get("rationale"))}</span>')
    if not parts:
        pairs = [f"{key}: {_scalar_text(item)}" for key, item in value.items() if item not in (None, "", [], {})]
        return esc(" / ".join(pairs)) if pairs else f'<span class="muted">{esc(empty)}</span>'
    return " ".join(parts)


def _scalar_text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "はい" if value else "いいえ"
    if isinstance(value, list):
        return ", ".join(_scalar_text(item) for item in value)
    if isinstance(value, dict):
        main = next(
            (value.get(key) for key in ("value", "text", "name", "description", "summary") if value.get(key) not in (None, "")),
            None,
        )
        if main is not None:
            return _scalar_text(main)
        return ", ".join(f"{key}={_scalar_text(item)}" for key, item in value.items() if item not in (None, "", [], {}))
    return str(value)


def _structured(value, empty="未確定"):
    """Render typed contract fragments without flattening fields or types."""
    if value in (None, "", [], {}):
        return f'<span class="muted">{esc(empty)}</span>'
    if isinstance(value, list):
        return '<ol class="structured-list">' + "".join(f"<li>{_structured(item, empty)}</li>" for item in value) + "</ol>"
    if not isinstance(value, dict):
        return esc(value)
    evidence_keys = {"value", "text", "name", "description", "summary", "basis", "source_refs", "sources", "rationale"}
    if set(value).issubset(evidence_keys) and any(key in value for key in ("value", "text", "name", "description", "summary")):
        return _evidence(value, empty)
    out = ['<dl class="structured-grid">']
    for key, item in value.items():
        if key in {"basis", "source_refs", "sources", "rationale"}:
            continue
        label = CONTRACT_FIELD_LABELS.get(key, key) if "CONTRACT_FIELD_LABELS" in globals() else key
        out.append(f'<dt>{esc(label)}</dt><dd>{_structured(item, empty)}</dd>')
    provenance = {"value": "", "basis": value.get("basis", ""), "source_refs": _source_refs(value), "rationale": value.get("rationale", "")}
    if any(provenance[key] for key in ("basis", "source_refs", "rationale")):
        out.append(f'<dt>根拠</dt><dd>{_evidence(provenance)}</dd>')
    out.append("</dl>")
    return "".join(out)


def _actors(value):
    if not isinstance(value, dict):
        return _evidence(value)
    labels = {
        "initiators": "起動者",
        "processors": "処理主体",
        "recipients": "受信者",
        "operators": "運用担当",
        "initiator": "起動者",
        "processor": "処理主体",
        "recipient": "受信者",
        "operator": "運用担当",
    }
    entries = []
    for key in ("initiators", "processors", "recipients", "operators", "initiator", "processor", "recipient", "operator"):
        values = value.get(key)
        if values not in (None, "", []):
            entries.append(f"<dt>{esc(labels[key])}</dt><dd>{_evidence(values)}</dd>")
    return '<dl class="actor-grid">' + "".join(entries) + "</dl>" if entries else _evidence(value)


def _actor_search_text(value):
    if isinstance(value, dict):
        return " ".join(_scalar_text(value.get(key)) for key in sorted(value))
    return " ".join(map(str, _as_list(value)))


def _row_table(headers, rows, caption, css_class="aux"):
    out = [f'<table class="{esc(css_class)}"><caption>{esc(caption)}</caption>']
    out.append("<thead><tr>" + "".join(f'<th scope="col">{esc(header)}</th>' for header in headers) + "</tr></thead><tbody>")
    if rows:
        for row in rows:
            cells = [f'<th scope="row">{row[0]}</th>'] if row else []
            cells.extend(f"<td>{cell}</td>" for cell in row[1:])
            out.append("<tr>" + "".join(cells) + "</tr>")
    else:
        out.append(f'<tr><td class="muted c" colspan="{len(headers)}">未確定</td></tr>')
    out.append("</tbody></table>")
    return out


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
                            f'<th scope="row" class="c{future}"><a class="fnlink" href="#detail-{esc(fid)}" data-detail="{esc(fid)}">{esc(fid)}</a></th>',
                            f'<td class="g{future}">{esc(function.get("name", ""))}</td>',
                            f'<td class="g{future}">{esc(function.get("summary", ""))}</td>',
                            f'<td class="g{future}">{_actors(function.get("actors"))}</td>',
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
                            _actor_search_text(function.get("actors")),
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
            ("アクター", _actors(function.get("actors"))),
            ("起動契機", _evidence(function.get("trigger"))),
            ("実行形態", _execution(function, interfaces)),
            ("入力", _structured(function.get("inputs"))),
            ("出力", _structured(function.get("outputs"))),
            ("事前条件", _evidence(function.get("preconditions"))),
            ("事後状態", _evidence(function.get("postconditions"))),
            ("業務ルール", _rules(function)),
            ("例外・失敗時", _exceptions(function)),
            ("対象データ", _structured(function.get("data_entities"))),
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
        + "".join(
            f'<th scope="col">{h}</th>'
            for h in ("根拠ID", "種別", "spec記載", "機能ID", "設計要素", "検証ID", "カバレッジ", "理由")
        )
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
            f'<th scope="row" class="c" id="source-{_anchor_token(source_id)}">{_badges([source_id])}</th>'
            f'<td>{esc(TYPE_LABELS.get(item.get("type"), item.get("type", "")))}</td>'
            f'<td>{esc(item.get("text", entry.get("summary", "")))}</td>'
            f"<td>{funcs}</td>"
            f'<td>{_badges(entry.get("design_refs")) or "<span class=\"muted\">—</span>"}</td>'
            f'<td>{_badges(entry.get("verification_ids")) or "<span class=\"muted\">—</span>"}</td>'
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


def _resolve_level(cfg, requested="auto"):
    if requested and requested != "auto":
        return requested
    configured = str(cfg.get("document_level", "")).strip()
    if configured in DOCUMENT_LEVEL_LABELS:
        return configured
    return "functional-design"


def _readiness_entry(report, key):
    entry = (report.get("readiness") or {}).get(key, "not-evaluated")
    if isinstance(entry, dict):
        return entry
    return {"status": entry}


def _source_artifacts(cfg):
    source = cfg.get("source") or {}
    artifacts = list(source.get("artifacts", []) or [])
    if not artifacts and source.get("spec"):
        artifacts = [{"type": "spec", "path": source.get("spec"), "locator": "", "fingerprint": ""}]
    rows = []
    for artifact in artifacts:
        if isinstance(artifact, str):
            artifact = {"path": artifact}
        locator = artifact.get("locator") or artifact.get("sections") or ""
        rows.append(
            [
                esc(artifact.get("type", "")),
                esc(artifact.get("path", artifact.get("file", ""))),
                esc(_scalar_text(locator)),
                esc(artifact.get("fingerprint", "")),
            ]
        )
    return rows


def _has_architecture_view(cfg):
    architecture = cfg.get("architecture") or {}
    if not isinstance(architecture, dict):
        return bool(architecture)
    return any(
        architecture.get(key)
        for key in (
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


def _question_table(cfg):
    rows = []
    for question in cfg.get("open_questions", []) or []:
        if question.get("status", "open") == "resolved":
            continue
        affected = (
            question.get("affected_refs")
            or question.get("function_ids")
            or question.get("design_refs")
            or []
        )
        rows.append(
            [
                esc(question.get("id", "")),
                esc(question.get("status", "open")),
                esc(question.get("question", "")),
                _badges(question.get("source_refs")),
                _badges(affected),
                esc(question.get("return_to", "")),
            ]
        )
    return _row_table(
        ("質問ID", "状態", "質問", "根拠", "影響先", "戻り先"),
        rows,
        "未確定事項と解消先",
    )


def _requirement_decision_rows(cfg):
    rows = []
    seen = set()
    for item in [*(cfg.get("requirement_decisions", []) or []), *(cfg.get("decisions", []) or [])]:
        identity = str(item.get("id") or f"{item.get('question', '')}\0{item.get('answer', '')}")
        if identity in seen:
            continue
        seen.add(identity)
        rows.append(
            [
                esc(item.get("id", "")),
                esc(item.get("question", item.get("title", ""))),
                esc(item.get("answer", item.get("decision", ""))),
                esc(item.get("source_locator", item.get("locator", ""))),
            ]
        )
    return rows


def _review(cfg, report, level):
    out = ['<h2 id="review">レビュー概要</h2>']
    label = DOCUMENT_LEVEL_LABELS.get(level, level)
    status = report.get("document_status") or level
    functions = [function for _, _, _, function in flatten_functions(cfg)]
    current_count = sum(1 for function in functions if not _is_future(function))
    future_count = sum(1 for function in functions if _is_future(function))
    risks = cfg.get("risks", []) or []
    delivery = cfg.get("delivery_summary") or {}
    out.append('<div class="review-banner">')
    out.append(f'<div><span>資料レベル</span><strong>{esc(label)}</strong></div>')
    out.append(f'<div><span>資料状態</span><strong>{esc(status)}</strong></div>')
    out.append(f'<div><span>スキーマ</span><strong>v{esc(cfg.get("schema_version", 3))}</strong></div>')
    out.append(f'<div><span>現行機能</span><strong>{current_count}</strong></div>')
    out.append(f'<div><span>将来機能</span><strong>{future_count}</strong></div>')
    out.append(f'<div><span>インターフェース</span><strong>{len(cfg.get("interfaces", []) or [])}</strong></div>')
    out.append(f'<div><span>リスク</span><strong>{len(risks)}</strong></div>')
    if delivery:
        out.append(
            f'<div><span>tasks完了</span><strong>{esc(delivery.get("completed", 0))}/{esc(delivery.get("total", 0))}</strong></div>'
        )
    out.append("</div>")
    if level == "functional-design":
        out.append(
            '<p class="notice">この資料は機能設計です。アーキテクチャ、物理データ設計、詳細契約、運用設計が未確定のため、実装準備完了を意味しません。</p>'
        )

    out.append('<h3>設計準備度</h3><div class="readiness-grid">')
    for key in READINESS_LABELS:
        entry = _readiness_entry(report, key)
        readiness_status = entry.get("status", "not-evaluated")
        out.append(
            f'<article class="readiness-card readiness-{esc(readiness_status)}"><span>{esc(READINESS_LABELS[key])}</span>'
            f'<strong>{esc(readiness_status)}</strong><p>{esc(entry.get("summary", entry.get("reason", "")))}</p>'
            f'<small>{esc(_scalar_text(entry.get("metrics", {})))}</small></article>'
        )
    out.append("</div>")
    out.append("<h3>入力成果物</h3>")
    out.extend(_row_table(("種別", "ファイル", "根拠箇所", "fingerprint"), _source_artifacts(cfg), "設計に使用した成果物"))
    decision_rows = _requirement_decision_rows(cfg)
    if decision_rows:
        out.append("<h3>要求上の確認済み決定</h3>")
        out.extend(_row_table(("ID", "質問", "回答", "spec記録箇所"), decision_rows, "Clarificationsから同期した決定"))

    applicability_rows = []
    applicability_labels = {"workflows": "処理フロー", "state_models": "状態遷移"}
    for key, entry in (cfg.get("applicability") or {}).items():
        if isinstance(entry, str):
            entry = {"status": entry}
        applicability_rows.append(
            [
                esc(applicability_labels.get(key, key)),
                esc(entry.get("status", "not-evaluated")),
                esc(entry.get("rationale", entry.get("reason", ""))),
                _badges(_source_refs(entry)),
            ]
        )
    if applicability_rows:
        out.append("<h3>条件付き設計資料の要否</h3>")
        out.extend(_row_table(("資料", "判定", "理由", "根拠"), applicability_rows, "フロー・状態遷移の適用判定"))

    out.append('<h3>未確定事項</h3>')
    out.extend(_question_table(cfg))
    risk_summary = [
        f"{risk.get('id', '')}: {risk.get('title', risk.get('name', risk.get('description', '')))}"
        f"（影響: {risk.get('impact', '未確定')} / 状態: {risk.get('status', '未確定')}）"
        for risk in risks
    ]
    out.append(f'<h3>主要リスク</h3>{_plain_list(risk_summary, "なし")}')
    out.append(
        f'<h3>実装依存関係</h3>{_plain_list(delivery.get("dependencies", []) if delivery else [], "tasks.md未指定")}'
    )
    priority_summary = []
    priority_counts = {}
    for function in functions:
        raw_priority = function.get("priority")
        if isinstance(raw_priority, dict):
            priority = str(raw_priority.get("value") or "unspecified").upper()
        else:
            priority = str(raw_priority or "unspecified").upper()
        label = "未指定" if priority == "UNSPECIFIED" else priority
        priority_counts[label] = priority_counts.get(label, 0) + 1
        priority_summary.append(
            f"{function.get('id', '')}: {function.get('name', '')}（{label}）"
        )
    count_summary = " / ".join(
        f"{priority}: {count}件" for priority, count in sorted(priority_counts.items())
    )
    out.append(f'<h3>要求優先度</h3><p>{esc(count_summary)}</p>{_plain_list(priority_summary, "機能なし")}')
    if not _has_architecture_view(cfg):
        out.append('<p class="unknown"><strong>システム構成:</strong> 未確定</p>')
    if not cfg.get("entities"):
        out.append('<p class="unknown"><strong>データモデル:</strong> 未確定</p>')
    if not any((interface.get("contract") or {}) for interface in cfg.get("interfaces", []) or []):
        out.append('<p class="unknown"><strong>詳細インターフェース契約:</strong> 未確定</p>')
    return out


def _safe_id(value):
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", str(value)).strip("-")
    return safe or "diagram"


def _svg_text(value):
    return html.escape(str(value or ""), quote=True)


def _short(value, limit=34):
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _diagram_sources(diagram, elements=(), relationships=()):
    refs = list(_source_refs(diagram))
    for item in [*elements, *relationships]:
        refs.extend(_source_refs(item))
    return list(dict.fromkeys(refs))


def _diagram_intro(title, legend, refs):
    return [
        f'<h3>{esc(title)}</h3>',
        f'<p class="diagram-legend"><strong>凡例:</strong> {esc(legend)}</p>',
        f'<p class="diagram-sources"><strong>根拠:</strong> {_badges(refs) or "<span class=\"muted\">未記録</span>"}</p>',
    ]


def _graph_diagram(diagram, key, default_title, legend):
    if isinstance(diagram, list):
        diagram = {"elements": diagram}
    diagram = diagram or {}
    elements = diagram.get("elements") or diagram.get("nodes") or diagram.get("systems") or []
    relationships = diagram.get("relationships") or diagram.get("connections") or []
    title = diagram.get("title") or default_title
    refs = _diagram_sources(diagram, elements, relationships)
    out = _diagram_intro(title, legend, refs)
    if not elements:
        out.append('<p class="muted">構成要素は未確定です。</p>')
        return out

    width = 960
    columns = 3
    node_width, node_height = 240, 86
    positions = {}
    for index, element in enumerate(elements):
        element_id = str(element.get("id") or element.get("name") or f"NODE-{index + 1}")
        positions[element_id] = (40 + (index % columns) * 310, 70 + (index // columns) * 145)
    rows = (len(elements) + columns - 1) // columns
    height = max(250, 130 + rows * 145)
    diagram_id = _safe_id(key)
    marker_id = f"arrow-{diagram_id}"
    title_id = f"title-{diagram_id}"
    out.append(f'<figure class="diagram"><svg class="diagram-svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="{title_id}">')
    out.append(f'<title id="{title_id}">{_svg_text(title)}</title>')
    out.append(f'<desc>{_svg_text(legend)}。同じ内容を直後の表でも確認できます。</desc>')
    out.append(f'<defs><marker id="{marker_id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path class="diagram-arrow" d="M0,0 L10,4 L0,8 z"></path></marker></defs>')
    for relationship in relationships:
        source = str(relationship.get("from") or relationship.get("source") or "")
        target = str(relationship.get("to") or relationship.get("target") or "")
        if source not in positions or target not in positions:
            continue
        sx, sy = positions[source]
        tx, ty = positions[target]
        x1, y1 = sx + node_width / 2, sy + node_height / 2
        x2, y2 = tx + node_width / 2, ty + node_height / 2
        out.append(f'<line class="diagram-edge" x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" marker-end="url(#{marker_id})"></line>')
        label = relationship.get("label") or relationship.get("description") or ""
        if label:
            out.append(f'<text class="diagram-edge-label" x="{(x1 + x2) / 2:g}" y="{(y1 + y2) / 2 - 6:g}">{_svg_text(_short(label, 26))}</text>')
    for index, element in enumerate(elements):
        element_id = str(element.get("id") or element.get("name") or f"NODE-{index + 1}")
        x, y = positions[element_id]
        kind = _safe_id(element.get("type", "element"))
        out.append(f'<g class="diagram-node node-{kind}"><rect x="{x}" y="{y}" width="{node_width}" height="{node_height}" rx="7"></rect>')
        out.append(f'<text class="diagram-node-kind" x="{x + 12}" y="{y + 20}">{_svg_text(element.get("type", ""))}</text>')
        out.append(f'<text class="diagram-node-name" x="{x + 12}" y="{y + 43}">{_svg_text(_short(element.get("name", element_id), 28))}</text>')
        out.append(f'<text class="diagram-node-desc" x="{x + 12}" y="{y + 65}">{_svg_text(_short(element.get("description", element.get("summary", "")), 34))}</text></g>')
    out.append("</svg></figure>")

    element_rows = [
        [
            f'<span id="{_design_anchor("architecture", element.get("id", element.get("name", "")))}">{esc(element.get("id", ""))}</span>',
            esc(element.get("type", "")),
            esc(element.get("name", "")),
            esc(element.get("description", element.get("summary", ""))),
            _badges(_source_refs(element)),
        ]
        for element in elements
    ]
    relation_rows = [
        [
            esc(relationship.get("from", relationship.get("source", ""))),
            esc(relationship.get("to", relationship.get("target", ""))),
            esc(relationship.get("label", relationship.get("description", ""))),
            _badges(_source_refs(relationship)),
        ]
        for relationship in relationships
    ]
    out.extend(_row_table(("ID", "種別", "名称", "説明", "根拠"), element_rows, f"{title}の構成要素", "aux diagram-table"))
    out.extend(_row_table(("接続元", "接続先", "関係", "根拠"), relation_rows, f"{title}の関係", "aux diagram-table"))
    return out


def _architecture(cfg):
    architecture = cfg.get("architecture") or {}
    out = ['<h2 id="architecture">システム構成</h2>']
    context = architecture.get("context") or architecture.get("system_context")
    containers = architecture.get("containers") or architecture.get("container")
    if context:
        out.extend(_graph_diagram(context, "architecture-context", "System Context", "人物・外部システム・対象システムと、その関係"))
    if containers:
        out.extend(_graph_diagram(containers, "architecture-containers", "Container", "実行・保存の主要境界と、その依存関係"))
    components = architecture.get("components") or architecture.get("component")
    if components:
        out.extend(
            _graph_diagram(
                components,
                "architecture-components",
                "Component",
                "明示的に必要とされた主要コンポーネントと依存関係",
            )
        )
    code_view = architecture.get("code")
    if code_view:
        out.extend(
            _graph_diagram(
                code_view,
                "architecture-code",
                "Code",
                "明示的に必要とされたコード要素と依存関係",
            )
        )
    decisions = architecture.get("decisions") or []
    if decisions:
        rows = [
            [
                esc(item.get("id", "")),
                esc(item.get("title", "")),
                _evidence(
                    {
                        "value": item.get("decision", item.get("rationale", "")),
                        "basis": item.get("basis", ""),
                        "source_refs": _source_refs(item),
                        "rationale": item.get("rationale", "") if item.get("decision") else "",
                    }
                ),
                _evidence(item.get("alternatives", []), "なし"),
                _evidence(item.get("consequences", []), "なし"),
                esc(item.get("status", "")),
                _badges(_source_refs(item)),
            ]
            for item in decisions
        ]
        out.extend(_row_table(("ID", "題名", "設計判断・理由", "代替案", "影響", "状態", "根拠"), rows, "アーキテクチャ設計判断"))
    operational_labels = {
        "deployment": "配置・実行環境",
        "observability": "監視・可観測性",
        "recovery": "障害復旧",
    }
    operational_rows = [
        [esc(label), _structured(architecture.get(key)), _badges(_source_refs(architecture.get(key)))]
        for key, label in operational_labels.items()
        if architecture.get(key)
    ]
    if operational_rows:
        out.extend(
            _row_table(
                ("設計領域", "内容・手順", "根拠"),
                operational_rows,
                "配置・監視・復旧設計",
            )
        )
    return out


def _workflow_participants(workflow):
    participants = []
    for index, participant in enumerate(workflow.get("participants", []) or [], 1):
        if isinstance(participant, str):
            participant = {"id": participant, "name": participant}
        participant = dict(participant)
        participant.setdefault("id", participant.get("name") or f"P-{index}")
        participant.setdefault("name", participant.get("id"))
        participants.append(participant)
    if participants:
        return participants
    seen = set()
    for step in workflow.get("steps", []) or []:
        for key in ("from", "to", "actor", "processor"):
            value = str(step.get(key, "")).strip()
            if value and value not in seen:
                seen.add(value)
                participants.append({"id": value, "name": value})
    return participants


def _workflow_table(workflow, title):
    out = []
    participant_rows = [
        [
            esc(participant.get("id", "")),
            esc(participant.get("name", "")),
            esc(participant.get("role", "")),
            _badges(_source_refs(participant)),
        ]
        for participant in _workflow_participants(workflow)
    ]
    if participant_rows:
        out.extend(
            _row_table(
                ("参加者ID", "名称", "役割", "根拠"),
                participant_rows,
                f"{title}の参加者",
                "aux diagram-table participant-table",
            )
        )
    rows = []
    for index, step in enumerate(workflow.get("steps", []) or [], 1):
        rows.append(
            [
                esc(step.get("id", index)),
                esc(step.get("from", step.get("actor", ""))),
                esc(step.get("to", step.get("processor", ""))),
                _evidence(step.get("action", step.get("name", step.get("description", "")))),
                _evidence(step.get("condition", step.get("next", "")), "なし"),
                esc(step.get("status", "normal")),
                _badges(_source_refs(step)),
            ]
        )
    out.extend(
        _row_table(
            ("順序", "起点", "終点", "処理", "条件・次状態", "種別", "根拠"),
            rows,
            f"{title}の構造化ステップ",
            "aux diagram-table step-table",
        )
    )
    return out


def _activity_diagram(workflow, key):
    title = workflow.get("name") or workflow.get("title") or workflow.get("id") or "処理フロー"
    steps = workflow.get("steps", []) or []
    refs = _diagram_sources(workflow, steps, [])
    out = _diagram_intro(title, "上から下へ処理順を示し、矢印上の文字は分岐・遷移条件を示す", refs)
    if not steps:
        out.append('<p class="muted">処理ステップは未確定です。</p>')
        return out
    width, node_width, node_height = 960, 600, 62
    x = (width - node_width) // 2
    height = 90 + len(steps) * 105
    diagram_id = _safe_id(key)
    marker_id = f"arrow-{diagram_id}"
    title_id = f"title-{diagram_id}"
    out.append(f'<figure class="diagram"><svg class="diagram-svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="{title_id}">')
    out.append(f'<title id="{title_id}">{_svg_text(title)}</title>')
    out.append('<desc>上から下へ処理順を示します。同じ内容を直後の表でも確認できます。</desc>')
    out.append(f'<defs><marker id="{marker_id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path class="diagram-arrow" d="M0,0 L10,4 L0,8 z"></path></marker></defs>')
    positions = {
        str(step.get("id") or index + 1): (x, 35 + index * 105)
        for index, step in enumerate(steps)
    }
    for index, step in enumerate(steps):
        source_id = str(step.get("id") or index + 1)
        raw_targets = step.get("next") or step.get("next_step_id")
        targets = _as_list(raw_targets)
        if not targets and index < len(steps) - 1:
            targets = [str(steps[index + 1].get("id") or index + 2)]
        sx, sy = positions[source_id]
        for target_value in targets:
            target_id = str(target_value.get("id") if isinstance(target_value, dict) else target_value)
            if target_id not in positions:
                continue
            tx, ty = positions[target_id]
            x1, y1 = sx + node_width / 2, sy + node_height
            x2, y2 = tx + node_width / 2, ty
            if abs(y2 - y1) <= 50:
                edge = f'<line class="diagram-edge" x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" marker-end="url(#{marker_id})"></line>'
            else:
                bend = width - 95 - (index % 3) * 28
                edge = (
                    f'<path class="diagram-edge" d="M{x1:g},{y1:g} C{bend:g},{y1:g} '
                    f'{bend:g},{y2:g} {x2:g},{y2:g}" marker-end="url(#{marker_id})"></path>'
                )
            out.append(edge)
            condition = step.get("condition") or (
                target_value.get("condition", "") if isinstance(target_value, dict) else ""
            )
            if condition:
                out.append(
                    f'<text class="diagram-edge-label" x="{width / 2 + 12:g}" '
                    f'y="{(y1 + y2) / 2:g}">{_svg_text(_short(_scalar_text(condition), 34))}</text>'
                )
    for index, step in enumerate(steps):
        y = 35 + index * 105
        action = step.get("action") or step.get("name") or step.get("description") or f"Step {index + 1}"
        actor = step.get("from") or step.get("actor") or ""
        step_status = step.get("status", "normal")
        out.append(f'<g class="diagram-node activity-node"><rect x="{x}" y="{y}" width="{node_width}" height="{node_height}" rx="10"></rect>')
        out.append(f'<text class="diagram-node-kind" x="{x + 14}" y="{y + 20}">{_svg_text(f"{actor} [{step_status}]".strip())}</text>')
        out.append(f'<text class="diagram-node-name" x="{x + 14}" y="{y + 44}">{_svg_text(_short(_scalar_text(action), 70))}</text></g>')
    out.append("</svg></figure>")
    out.extend(_workflow_table(workflow, title))
    return out


def _sequence_diagram(workflow, key):
    title = workflow.get("name") or workflow.get("title") or workflow.get("id") or "シーケンス"
    participants = _workflow_participants(workflow)
    steps = workflow.get("steps", []) or []
    refs = _diagram_sources(workflow, [*participants, *steps], [])
    out = _diagram_intro(title, "上から下が時系列、縦線は参加者、横矢印はメッセージ・処理呼出し", refs)
    if not participants or not steps:
        out.append('<p class="muted">参加者または処理ステップは未確定です。</p>')
        out.extend(_workflow_table(workflow, title))
        return out
    width = max(960, len(participants) * 220)
    height = 150 + len(steps) * 58
    spacing = width / len(participants)
    positions = {str(participant.get("id")): spacing * (index + 0.5) for index, participant in enumerate(participants)}
    diagram_id = _safe_id(key)
    marker_id = f"arrow-{diagram_id}"
    title_id = f"title-{diagram_id}"
    out.append(f'<figure class="diagram"><svg class="diagram-svg" viewBox="0 0 {width:g} {height}" role="img" aria-labelledby="{title_id}">')
    out.append(f'<title id="{title_id}">{_svg_text(title)}</title>')
    out.append('<desc>参加者間のメッセージ順を上から下へ示します。同じ内容を直後の表でも確認できます。</desc>')
    out.append(f'<defs><marker id="{marker_id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path class="diagram-arrow" d="M0,0 L10,4 L0,8 z"></path></marker></defs>')
    for participant in participants:
        participant_id = str(participant.get("id"))
        x = positions[participant_id]
        out.append(f'<g class="sequence-participant"><rect x="{x - 78:g}" y="30" width="156" height="48" rx="6"></rect>')
        out.append(f'<text class="diagram-node-name" text-anchor="middle" x="{x:g}" y="59">{_svg_text(_short(participant.get("name", participant_id), 20))}</text>')
        out.append(f'<line class="sequence-lifeline" x1="{x:g}" y1="78" x2="{x:g}" y2="{height - 25}"></line></g>')
    for index, step in enumerate(steps):
        source = str(step.get("from") or step.get("actor") or "")
        target = str(step.get("to") or step.get("processor") or source)
        if source not in positions or target not in positions:
            continue
        y = 112 + index * 58
        x1, x2 = positions[source], positions[target]
        if x1 == x2:
            x2 = x1 + 55
        out.append(f'<line class="diagram-edge" x1="{x1:g}" y1="{y}" x2="{x2:g}" y2="{y}" marker-end="url(#{marker_id})"></line>')
        action = step.get("action") or step.get("name") or step.get("description") or ""
        label = f"[{step.get('status', 'normal')}] {_scalar_text(action)}"
        out.append(f'<text class="diagram-edge-label" text-anchor="middle" x="{(x1 + x2) / 2:g}" y="{y - 8}">{_svg_text(_short(label, 38))}</text>')
    out.append("</svg></figure>")
    out.extend(_workflow_table(workflow, title))
    return out


def _state_diagram(model, key):
    title = model.get("name") or model.get("title") or model.get("entity") or model.get("id") or "状態遷移"
    raw_states = model.get("states", []) or []
    states = [({"id": state, "name": state} if isinstance(state, str) else state) for state in raw_states]
    transitions = model.get("transitions", []) or []
    refs = _diagram_sources(model, states, transitions)
    out = _diagram_intro(title, "二重枠は終端状態、太枠は初期状態、矢印は状態遷移", refs)
    if not states:
        out.append('<p class="muted">状態は未確定です。</p>')
        return out
    columns, width = 4, 960
    node_width, node_height = 180, 62
    positions = {}
    for index, state in enumerate(states):
        state_id = str(state.get("id") or state.get("name") or f"STATE-{index + 1}")
        positions[state_id] = (35 + (index % columns) * 235, 65 + (index // columns) * 135)
    height = max(245, 135 + ((len(states) + columns - 1) // columns) * 135)
    diagram_id = _safe_id(key)
    marker_id = f"arrow-{diagram_id}"
    title_id = f"title-{diagram_id}"
    out.append(f'<figure class="diagram"><svg class="diagram-svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="{title_id}">')
    out.append(f'<title id="{title_id}">{_svg_text(title)}</title>')
    out.append('<desc>状態と許可された遷移を示します。同じ内容を直後の表でも確認できます。</desc>')
    out.append(f'<defs><marker id="{marker_id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path class="diagram-arrow" d="M0,0 L10,4 L0,8 z"></path></marker></defs>')
    for transition in transitions:
        source = str(transition.get("from", ""))
        target = str(transition.get("to", ""))
        if source not in positions or target not in positions:
            continue
        sx, sy = positions[source]
        tx, ty = positions[target]
        x1, y1 = sx + node_width / 2, sy + node_height / 2
        x2, y2 = tx + node_width / 2, ty + node_height / 2
        out.append(f'<line class="diagram-edge" x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" marker-end="url(#{marker_id})"></line>')
        trigger = transition.get("trigger") or transition.get("event") or ""
        if trigger:
            out.append(f'<text class="diagram-edge-label" x="{(x1 + x2) / 2:g}" y="{(y1 + y2) / 2 - 7:g}">{_svg_text(_short(_scalar_text(trigger), 24))}</text>')
    for index, state in enumerate(states):
        state_id = str(state.get("id") or state.get("name") or f"STATE-{index + 1}")
        x, y = positions[state_id]
        flags = " initial-state" if state.get("initial") else ""
        flags += " terminal-state" if state.get("terminal") or state.get("final") else ""
        out.append(f'<g class="diagram-node state-node{flags}"><rect x="{x}" y="{y}" width="{node_width}" height="{node_height}" rx="22"></rect>')
        if state.get("terminal") or state.get("final"):
            out.append(f'<rect class="terminal-inner" x="{x + 5}" y="{y + 5}" width="{node_width - 10}" height="{node_height - 10}" rx="18"></rect>')
        out.append(f'<text class="diagram-node-name" text-anchor="middle" x="{x + node_width / 2:g}" y="{y + 37}">{_svg_text(_short(state.get("name", state_id), 20))}</text></g>')
    out.append("</svg></figure>")
    state_rows = [
        [
            esc(state.get("id", "")),
            esc(state.get("name", "")),
            esc("初期" if state.get("initial") else ""),
            esc("終端" if state.get("terminal") or state.get("final") else ""),
            _badges(_source_refs(state)),
        ]
        for state in states
    ]
    transition_rows = [
        [
            esc(item.get("from", "")),
            esc(item.get("to", "")),
            _evidence(item.get("trigger", item.get("event", ""))),
            _evidence(item.get("condition", ""), "なし"),
            _evidence(item.get("action", ""), "なし"),
            _badges(_source_refs(item)),
        ]
        for item in transitions
    ]
    out.extend(_row_table(("状態ID", "状態", "初期", "終端", "根拠"), state_rows, f"{title}の状態", "aux diagram-table"))
    out.extend(_row_table(("遷移元", "遷移先", "契機", "条件", "処理", "根拠"), transition_rows, f"{title}の遷移", "aux diagram-table"))
    policy = model.get("unlisted_transitions") or model.get("undefined_transition_policy")
    if policy:
        policy_refs = _source_refs(policy) or _source_refs(model)
        out.extend(
            _row_table(
                ("規則", "未定義・禁止遷移の扱い", "根拠"),
                [["未定義遷移", _structured(policy), _badges(policy_refs)]],
                f"{title}の禁止遷移方針",
                "aux diagram-table",
            )
        )
    return out


def _flows(cfg):
    out = ['<h2 id="flows">フロー・状態</h2>']
    for index, workflow in enumerate(cfg.get("workflows", []) or [], 1):
        workflow_id = workflow.get("id", f"WF-{index}")
        out.append(
            f'<span class="anchor-target" id="{_design_anchor("workflow", workflow_id)}" aria-hidden="true"></span>'
        )
        if workflow.get("not_required_reason"):
            out.append(f'<h3>{esc(workflow.get("name", workflow.get("id", f"Workflow {index}")))}</h3>')
            out.append(f'<p class="notice">図示不要: {esc(workflow.get("not_required_reason"))}</p>')
            continue
        kind = workflow.get("type") or workflow.get("kind") or "activity"
        if kind == "sequence":
            out.extend(_sequence_diagram(workflow, f"workflow-{index}"))
        else:
            out.extend(_activity_diagram(workflow, f"workflow-{index}"))
    for index, model in enumerate(cfg.get("state_models", []) or [], 1):
        model_id = model.get("id", f"STM-{index}")
        out.append(
            f'<span class="anchor-target" id="{_design_anchor("state-model", model_id)}" aria-hidden="true"></span>'
        )
        if model.get("not_required_reason"):
            out.append(f'<h3>{esc(model.get("name", model.get("id", f"State model {index}")))}</h3>')
            out.append(f'<p class="notice">状態遷移表不要: {esc(model.get("not_required_reason"))}</p>')
            continue
        out.extend(_state_diagram(model, f"state-model-{index}"))
    return out


def _entity_relationships(cfg, entities):
    relationships = list(cfg.get("entity_relationships", []) or [])
    for entity in entities:
        source_id = str(entity.get("id") or entity.get("name") or "")
        for relationship in entity.get("relationships", []) or []:
            if isinstance(relationship, str):
                relationship = {"to": relationship}
            normalized = dict(relationship)
            normalized.setdefault("from", source_id)
            relationships.append(normalized)
    return relationships


def _data_model(cfg):
    raw_entities = cfg.get("entities", []) or []
    entities = [({"id": entity, "name": entity} if isinstance(entity, str) else entity) for entity in raw_entities]
    relationships = _entity_relationships(cfg, entities)
    title = "論理データモデル"
    evidence_items = list(entities)
    for entity in entities:
        evidence_items.extend(item for item in entity.get("attributes", []) or [] if isinstance(item, dict))
        evidence_items.extend(item for item in entity.get("constraints", []) or [] if isinstance(item, dict))
    refs = _diagram_sources({}, evidence_items, relationships)
    out = ['<h2 id="data-model">データモデル</h2>', *_diagram_intro(title, "箱は論理エンティティ、線はエンティティ間の関係", refs)]
    if not entities:
        out.append('<p class="muted">論理エンティティは未確定です。</p>')
        return out
    columns, width = 3, 960
    node_width, node_height = 250, 118
    positions = {}
    for index, entity in enumerate(entities):
        entity_id = str(entity.get("id") or entity.get("name") or f"ENTITY-{index + 1}")
        positions[entity_id] = (35 + (index % columns) * 310, 65 + (index // columns) * 175)
    height = max(275, 145 + ((len(entities) + columns - 1) // columns) * 175)
    marker_id = "arrow-er-model"
    title_id = "title-er-model"
    out.append(f'<figure class="diagram"><svg class="diagram-svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="{title_id}">')
    out.append(f'<title id="{title_id}">{_svg_text(title)}</title>')
    out.append('<desc>論理エンティティ、属性、関係を示します。同じ内容を直後の表でも確認できます。</desc>')
    out.append(f'<defs><marker id="{marker_id}" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path class="diagram-arrow" d="M0,0 L10,4 L0,8 z"></path></marker></defs>')
    for relationship in relationships:
        source = str(relationship.get("from", ""))
        target = str(relationship.get("to", relationship.get("target", "")))
        if source not in positions or target not in positions:
            continue
        sx, sy = positions[source]
        tx, ty = positions[target]
        x1, y1 = sx + node_width / 2, sy + node_height / 2
        x2, y2 = tx + node_width / 2, ty + node_height / 2
        out.append(f'<line class="diagram-edge" x1="{x1:g}" y1="{y1:g}" x2="{x2:g}" y2="{y2:g}" marker-end="url(#{marker_id})"></line>')
        label = relationship.get("label") or relationship.get("type") or relationship.get("cardinality") or ""
        if label:
            out.append(f'<text class="diagram-edge-label" x="{(x1 + x2) / 2:g}" y="{(y1 + y2) / 2 - 7:g}">{_svg_text(_short(label, 24))}</text>')
    for index, entity in enumerate(entities):
        entity_id = str(entity.get("id") or entity.get("name") or f"ENTITY-{index + 1}")
        x, y = positions[entity_id]
        out.append(f'<g class="diagram-node entity-node"><rect x="{x}" y="{y}" width="{node_width}" height="{node_height}" rx="5"></rect>')
        out.append(f'<line class="entity-divider" x1="{x}" y1="{y + 34}" x2="{x + node_width}" y2="{y + 34}"></line>')
        out.append(f'<text class="diagram-node-name" x="{x + 12}" y="{y + 23}">{_svg_text(_short(entity.get("name", entity_id), 28))}</text>')
        for attribute_index, attribute in enumerate((entity.get("attributes", []) or [])[:4]):
            attribute_name = attribute if isinstance(attribute, str) else attribute.get("name", "")
            attribute_type = "" if isinstance(attribute, str) else attribute.get("type", "")
            out.append(f'<text class="entity-attribute" x="{x + 12}" y="{y + 55 + attribute_index * 16}">{_svg_text(_short(f"{attribute_name}: {attribute_type}".rstrip(": "), 34))}</text>')
        out.append("</g>")
    out.append("</svg></figure>")

    entity_rows = [
        [
            f'<span id="{_design_anchor("entity", entity.get("id", entity.get("name", "")))}">{esc(entity.get("id", ""))}</span>',
            esc(entity.get("name", "")),
            esc(entity.get("description", entity.get("desc", ""))),
            _badges(_source_refs(entity)),
        ]
        for entity in entities
    ]
    attribute_rows = []
    constraint_rows = []
    for entity in entities:
        entity_id = entity.get("id", entity.get("name", ""))
        attributes = entity.get("attributes", []) or []
        if not attributes:
            attribute_rows.append([esc(entity_id), esc(entity.get("name", "")), '<span class="muted">未確定</span>', "", "", _badges(_source_refs(entity))])
        for attribute in attributes:
            if isinstance(attribute, str):
                attribute = {"name": attribute}
            required = attribute.get("required")
            attribute_evidence = {
                "value": attribute.get("description", ""),
                "basis": attribute.get("basis", ""),
                "source_refs": _source_refs(attribute),
                "rationale": attribute.get("rationale", ""),
            }
            attribute_rows.append(
                [
                    esc(entity_id),
                    esc(entity.get("name", "")),
                    esc(attribute.get("name", "")),
                    esc(attribute.get("type", "")),
                    esc("必須" if required is True else "任意" if required is False else ""),
                    _evidence(attribute_evidence),
                ]
            )
        for constraint in entity.get("constraints", []) or []:
            constraint_rows.append(
                [
                    esc(entity_id),
                    _evidence(constraint),
                    _badges(_source_refs(constraint)) if isinstance(constraint, dict) else "",
                ]
            )
    relationship_rows = [
        [
            esc(item.get("from", "")),
            esc(item.get("to", item.get("target", ""))),
            esc(item.get("type", item.get("cardinality", ""))),
            esc(item.get("label", item.get("description", ""))),
            _badges(_source_refs(item)),
        ]
        for item in relationships
    ]
    out.extend(_row_table(("ID", "名称", "説明", "根拠"), entity_rows, "論理エンティティ", "aux diagram-table"))
    out.extend(_row_table(("エンティティID", "名称", "属性", "型", "必須", "説明・根拠"), attribute_rows, "論理エンティティと属性", "aux diagram-table"))
    out.extend(_row_table(("関係元", "関係先", "多重度・種別", "説明", "根拠"), relationship_rows, "エンティティ間の関係", "aux diagram-table"))
    if constraint_rows:
        out.extend(_row_table(("エンティティID", "制約", "根拠"), constraint_rows, "データ制約", "aux diagram-table"))
    return out


CONTRACT_FIELD_LABELS = {
    "method": "HTTPメソッド",
    "path": "パス",
    "auth": "認証・認可",
    "request": "要求",
    "response": "応答",
    "responses": "応答",
    "errors": "エラー",
    "error": "エラー",
    "idempotency": "冪等性",
    "transaction": "トランザクション",
    "concurrency": "排他・競合",
    "schedule": "スケジュール",
    "timezone": "タイムゾーン",
    "input": "入力",
    "output": "出力",
    "recovery": "復旧",
    "retry": "再試行",
    "producer": "生成元",
    "consumer": "購読先",
    "consumers": "購読先",
    "trigger": "起動契機",
    "payload": "ペイロード",
    "delivery": "配送保証",
    "ordering": "順序保証",
    "deduplication": "重複排除",
    "format": "形式",
    "direction": "方向",
    "protocol": "プロトコル",
    "endpoint_or_channel": "接続先・チャネル",
    "timeout": "タイムアウト",
    "source": "連携元",
    "destination": "連携先",
    "validation": "入力検証",
    "navigation": "画面遷移",
    "route": "ルート",
    "view_id": "ビューID",
    "fields": "項目",
    "permissions": "権限",
    "actions": "主要操作",
    "error_display": "エラー表示",
    "procedure": "手順",
    "steps": "手順",
    "initiator": "起動者",
    "preconditions": "事前条件",
    "evidence": "実施証跡",
    "approval": "承認",
    "failure": "失敗時",
    "rollback": "ロールバック",
    "completion_record": "完了記録",
    "roles": "担当ロール",
    "inputs": "入力",
    "outputs": "出力",
    "target_range": "対象範囲",
    "overlap_policy": "多重起動",
    "monitoring": "監視・通知",
    "source_refs": "根拠",
    "basis": "根拠区分",
    "rationale": "導出理由",
}

CONTRACT_FIELD_ORDER = {
    "api": ("method", "path", "auth", "request", "responses", "response", "errors", "idempotency", "transaction", "concurrency"),
    "batch": ("schedule", "timezone", "initiator", "inputs", "outputs", "input", "output", "target_range", "overlap_policy", "transaction", "retry", "recovery", "monitoring", "concurrency"),
    "event": ("producer", "consumers", "consumer", "trigger", "payload", "delivery", "ordering", "deduplication", "retry", "recovery", "idempotency"),
    "external-interface": ("direction", "protocol", "endpoint_or_channel", "auth", "payload", "format", "timeout", "delivery", "retry", "recovery", "source", "destination"),
    "screen": ("route", "view_id", "fields", "permissions", "input", "output", "validation", "actions", "navigation", "error_display", "auth"),
    "manual": ("initiator", "preconditions", "steps", "procedure", "evidence", "approval", "failure", "rollback", "recovery", "completion_record", "roles", "input", "output"),
}


def _contract_entries(interface):
    contract = interface.get("contract") or {}
    if not isinstance(contract, dict):
        return [("契約", contract)]
    kind = interface.get("type", "")
    ordered_keys = list(CONTRACT_FIELD_ORDER.get(kind, ()))
    ordered_keys.extend(key for key in contract if key not in ordered_keys and key not in {"source_refs", "basis", "rationale"})
    return [(CONTRACT_FIELD_LABELS.get(key, key), contract.get(key)) for key in ordered_keys if contract.get(key) not in (None, "", [], {})]


def _contracts(cfg):
    out = ['<h2 id="interfaces">インターフェース・契約</h2>']
    interfaces = cfg.get("interfaces", []) or []
    overview_rows = [
        [
            esc(interface.get("id", "")),
            esc(interface.get("type", "")),
            esc(interface.get("name", "")),
            esc(interface.get("summary", "")),
            _actors(interface.get("actors")),
            _status(interface),
        ]
        for interface in interfaces
    ]
    out.extend(_row_table(("ID", "種別", "名称", "概要", "アクター", "状態"), overview_rows, "機能の実行接点"))
    for interface in interfaces:
        interface_id = interface.get("id", "")
        out.append(
            f'<article class="contract-card" id="{_design_anchor("interface", interface_id)}">'
        )
        out.append(f'<header><span class="fnid">{esc(interface_id)}</span><h3>{esc(interface.get("name", ""))}</h3>{_status(interface)}</header>')
        contract = interface.get("contract") or {}
        entries = _contract_entries(interface)
        if not entries:
            out.append('<p class="unknown">詳細契約は未確定です。</p>')
        else:
            out.append('<dl class="detail-grid contract-grid">')
            for label, value in entries:
                out.append(f'<dt>{esc(label)}</dt><dd>{_structured(value)}</dd>')
            if isinstance(contract, dict):
                if contract.get("basis"):
                    out.append(f'<dt>根拠区分</dt><dd>{_evidence({"value": contract.get("basis"), "basis": contract.get("basis"), "source_refs": _source_refs(contract), "rationale": contract.get("rationale")})}</dd>')
                elif _source_refs(contract):
                    out.append(f'<dt>根拠</dt><dd>{_badges(_source_refs(contract))}</dd>')
            out.append("</dl>")
        out.append("</article>")
    if not interfaces:
        out.append('<p class="unknown">インターフェースは未確定です。</p>')
    return out


def _quality_v3(cfg, report):
    out = ['<h2 id="quality">品質・検証・リスク</h2>', '<h3>設計準備度</h3><div class="readiness-grid">']
    for key in READINESS_LABELS:
        entry = _readiness_entry(report, key)
        status = entry.get("status", "not-evaluated")
        detail_count = len(entry.get("errors", []) or []) + len(entry.get("warnings", []) or [])
        out.append(
            f'<article class="readiness-card readiness-{esc(status)}"><span>{esc(READINESS_LABELS[key])}</span>'
            f'<strong>{esc(status)}</strong><p>{esc(entry.get("summary", entry.get("reason", "")))}</p>'
            f'<small>{esc(_scalar_text(entry.get("metrics", {})))} / 指摘 {detail_count}件</small></article>'
        )
    out.append("</div>")

    scenario_rows = [
        [
            f'<span id="{_design_anchor("quality-scenario", item.get("id", ""))}">{esc(item.get("id", ""))}</span>',
            esc(item.get("category", "")),
            _evidence(item.get("scenario", item.get("stimulus", ""))),
            _evidence(item.get("response", "")),
            _evidence(item.get("measure", item.get("criterion", ""))),
            _badges(_source_refs(item)),
        ]
        for item in cfg.get("quality_scenarios", []) or []
    ]
    out.extend(_row_table(("ID", "品質特性", "シナリオ", "期待応答", "測定基準", "根拠"), scenario_rows, "非機能品質シナリオ"))

    verification_rows = [
        [
            f'<span id="verification-{_anchor_token(item.get("id", ""))}">{esc(item.get("id", ""))}</span>',
            _badges([item.get("source_id", item.get("criterion_id", ""))]),
            esc(item.get("level", item.get("type", ""))),
            _evidence(item.get("method", "")),
            _evidence(item.get("expected_result", item.get("expected", ""))),
            esc(item.get("status", "")),
        ]
        for item in cfg.get("verification", []) or []
    ]
    out.extend(_row_table(("ID", "成功基準", "レベル", "検証方法", "期待結果", "状態"), verification_rows, "成功基準の検証計画"))

    risk_rows = [
        [
            f'<span id="{_design_anchor("risk", item.get("id", ""))}">{esc(item.get("id", ""))}</span>',
            esc(item.get("title", item.get("name", ""))),
            esc(item.get("probability", item.get("likelihood", ""))),
            esc(item.get("impact", "")),
            _evidence(item.get("mitigation", item.get("response", ""))),
            esc(item.get("owner", "undetermined")),
            esc(item.get("status", "")),
            _badges(_source_refs(item)),
        ]
        for item in cfg.get("risks", []) or []
    ]
    out.extend(_row_table(("ID", "リスク", "発生可能性", "影響", "対応", "所有者", "状態", "根拠"), risk_rows, "設計・実装リスク"))

    for key, heading in (("errors", "ブロッキングエラー"), ("warnings", "警告")):
        out.append(f"<h3>{heading}</h3>{_plain_list(report.get(key), 'なし')}")
    out.append('<h3>ユーザー確認待ち</h3>')
    out.extend(_question_table(cfg))
    out.append("<h3>確認済み決定</h3>")
    out.extend(_row_table(("ID", "質問", "回答", "spec記録箇所"), _requirement_decision_rows(cfg), "要求上の確認済み決定"))
    return out


def _delivery(cfg):
    summary = cfg.get("delivery_summary") or {}
    out = ['<h2 id="delivery">実装計画要約</h2>', '<p class="notice">tasks.md等の正本を読み取り専用で要約しています。見積り・担当・日程の正本ではありません。</p>']
    out.append(f'<p><strong>根拠:</strong> {_badges(_source_refs(summary)) or "<span class=\"muted\">未記録</span>"}</p>')
    phases = summary.get("phases", []) or []
    phase_rows = []
    for index, phase in enumerate(phases, 1):
        if isinstance(phase, str):
            phase = {"name": phase}
        phase_rows.append(
            [
                esc(phase.get("id", index)),
                esc(phase.get("name", phase.get("title", ""))),
                esc(phase.get("status", "")),
                esc(phase.get("completed", "")),
                esc(phase.get("total", "")),
                _badges(_source_refs(phase)),
            ]
        )
    out.extend(_row_table(("順序", "フェーズ", "状態", "完了", "総数", "根拠"), phase_rows, "実装フェーズ"))
    dependencies = summary.get("dependencies", []) or []
    dependency_rows = []
    for dependency in dependencies:
        if isinstance(dependency, str):
            dependency = {"description": dependency}
        dependency_rows.append(
            [
                esc(dependency.get("from", "")),
                esc(dependency.get("to", "")),
                esc(dependency.get("description", dependency.get("reason", ""))),
                _badges(_source_refs(dependency)),
            ]
        )
    out.extend(_row_table(("依存元", "依存先", "内容", "根拠"), dependency_rows, "フェーズ・作業依存関係"))
    completed = summary.get("completed")
    total = summary.get("total")
    if completed is not None or total is not None:
        out.append(f'<p class="delivery-progress"><strong>完了状況:</strong> {esc(completed or 0)} / {esc(total or 0)}</p>')
    return out


CSS = """
:root{--grid:%(grid)s;--hdr:%(hdr)s;--dai:%(dai)s;--chu:%(chu)s;--sho0:%(sho0)s;--sho1:%(sho1)s;--future:%(future)s;}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{font-family:"游ゴシック","Yu Gothic",YuGothic,Meiryo,sans-serif;font-size:13px;color:#222;margin:0;padding:24px;background:#fff;line-height:1.5}
.titlebar{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin:4px 0 16px;flex-wrap:wrap}.title{font-size:26px;font-weight:700;margin:0;letter-spacing:.04em}table.meta{border-collapse:collapse;font-size:12px;width:auto}table.meta td{border:1px solid var(--grid);padding:3px 10px;white-space:nowrap}table.meta td.k{background:var(--hdr);text-align:center}
h2{font-size:17px;margin:6px 0 10px;padding-left:8px;border-left:6px solid var(--dai)}h3{font-size:14px;margin:18px 0 7px}table{border-collapse:collapse;width:100%%;table-layout:fixed}caption{font-weight:700;text-align:left;margin:0 0 6px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
th,td{border:1px solid var(--grid);padding:5px 7px;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}thead th{background:var(--hdr);text-align:center;vertical-align:middle;position:sticky;top:46px;z-index:2}td.c{text-align:center}td.dai,td.chu,td.sho0,td.sho1{vertical-align:middle;font-weight:600}td.dai{background:var(--dai)}td.chu{background:var(--chu)}td.sho0{background:var(--sho0)}td.sho1{background:var(--sho1)}td.g{background:#fff}td.future,.future-card{background:var(--future);color:#666}.muted{color:#888}.idbadge,.fnid,.ref{font-size:11px;font-weight:700;background:#edf4f7;border:1px solid #c7dde5;border-radius:3px;padding:1px 4px;white-space:nowrap}.fnlink{color:#12677d;font-weight:700}.status,.kind,.basis,.coverage{display:inline-block;font-size:11px;font-weight:700;border-radius:10px;padding:1px 7px;white-space:nowrap}.current-tag{background:#e5f4ea;color:#27643a}.future-tag{background:#fdeccb;color:#805300}.kind{background:#eaf1f8;color:#315c7b}.basis-specified{background:#e8f3fb;color:#245d83}.basis-derived{background:#fff1da;color:#805300}.basis-confirmed{background:#e5f4ea;color:#27643a}.coverage-covered{background:#e5f4ea}.coverage-partial,.coverage-unresolved{background:#fde5e5;color:#8b2929}.coverage-future{background:#fdeccb}.coverage-out-of-scope{background:#eee;color:#555}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}.toolbar label{font-size:12px;font-weight:600}.toolbar input,.toolbar select{font:inherit;border:1px solid #aebbc4;border-radius:4px;padding:5px 8px;background:#fff}.funclist th:nth-child(1),.funclist th:nth-child(2),.funclist th:nth-child(3){width:7%%}.funclist th:nth-child(4){width:6%%}.funclist th:nth-child(5){width:10%%}.funclist th:nth-child(6){width:19%%}.funclist th:nth-child(7){width:8%%}.funclist th:nth-child(8){width:10%%}.funclist th:nth-child(9){width:12%%}.funclist th:nth-child(10){width:7%%}
.function-card{border:1px solid var(--grid);border-left:5px solid var(--dai);border-radius:4px;margin:0 0 14px;padding:12px;background:#fff}.function-card header{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.function-card h3{font-size:16px;margin:0}.breadcrumb{font-size:12px;color:#567;margin:6px 0}.summary{font-weight:600}.detail-grid{display:grid;grid-template-columns:130px minmax(0,1fr);margin:0;border-top:1px solid var(--grid);border-left:1px solid var(--grid)}.detail-grid dt,.detail-grid dd{margin:0;padding:6px 8px;border-right:1px solid var(--grid);border-bottom:1px solid var(--grid)}.detail-grid dt{background:#eef5f7;font-weight:700}.detail-grid ul,.rules{margin:0;padding-left:20px}.rationale{font-size:12px;color:#66512b;margin-top:2px}
.actor-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 7px;margin:0}.actor-grid dt{font-size:11px;font-weight:700;color:#567}.actor-grid dd{margin:0}.actor-grid ul{margin:0;padding-left:17px}.structured-grid{display:grid;grid-template-columns:minmax(90px,max-content) minmax(0,1fr);margin:0;border-top:1px solid #d8e0e5;border-left:1px solid #d8e0e5}.structured-grid dt,.structured-grid dd{margin:0;padding:4px 6px;border-right:1px solid #d8e0e5;border-bottom:1px solid #d8e0e5}.structured-grid dt{background:#f3f6f8;font-weight:700}.structured-list{margin:0;padding-left:20px}
.review-banner,.readiness-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:9px;margin:0 0 12px}.review-banner>div,.readiness-card{border:1px solid var(--grid);border-top:4px solid var(--dai);padding:9px 12px;background:#fff}.review-banner span,.readiness-card span{display:block;font-size:11px;color:#667}.review-banner strong,.readiness-card strong{font-size:17px}.readiness-card p{margin:4px 0;font-size:12px}.readiness-passed{border-top-color:#4f9963}.readiness-failed{border-top-color:#b84a4a}.readiness-not-evaluated{border-top-color:#b29a56}.readiness-not-applicable{border-top-color:#929aa0}.notice,.unknown{border-left:4px solid #c49132;background:#fff7e4;padding:8px 10px}.unknown{border-left-color:#8b98a2;background:#f1f4f6}
.diagram{margin:8px 0 12px;border:1px solid var(--grid);background:#fbfcfd;overflow-x:auto}.diagram-svg{display:block;width:100%%;height:auto;min-width:720px}.diagram-node rect,.sequence-participant rect{fill:#fff;stroke:#32788c;stroke-width:2}.node-person rect{fill:#fff3da}.node-external-system rect,.node-external rect{fill:#f1f2f3}.node-container rect{fill:#e9f5f8}.diagram-node-name{font-size:14px;font-weight:700;fill:#173b46}.diagram-node-kind,.diagram-node-desc,.entity-attribute{font-size:11px;fill:#526a72}.diagram-edge{stroke:#5b7078;stroke-width:1.7;fill:none}.diagram-arrow{fill:#5b7078}.diagram-edge-label{font-size:10px;font-weight:600;fill:#334d56;paint-order:stroke;stroke:#fff;stroke-width:4;stroke-linejoin:round}.sequence-lifeline{stroke:#7b8a90;stroke-width:1.2;stroke-dasharray:5 4}.initial-state rect{stroke-width:4}.terminal-state rect{stroke-width:4}.entity-divider{stroke:#32788c;stroke-width:1}.diagram-legend,.diagram-sources{font-size:12px;margin:4px 0}.diagram-table{margin-bottom:14px}
.terminal-state .terminal-inner{fill:none;stroke-width:2}.contract-card{border:1px solid var(--grid);border-left:5px solid #5c88a5;border-radius:4px;margin:14px 0;padding:12px}.contract-card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.contract-card h3{margin:0}.delivery-progress{font-size:16px}.aux th:nth-child(1){width:11%%}.aux th:nth-child(2){width:13%%}.aux th:nth-child(4){width:15%%}.aux th:nth-child(5){width:12%%}.compact{max-width:720px}.quality-summary{display:flex;gap:8px;flex-wrap:wrap}.quality-card{border:1px solid var(--grid);border-top:4px solid var(--dai);min-width:130px;padding:8px 12px}.quality-card span{display:block;font-size:11px;color:#667}.quality-card strong{font-size:20px}.panel{display:none}.panel.active{display:block}.tabbar{position:sticky;top:0;z-index:6;display:flex;gap:4px;align-items:flex-end;background:#fff;border-bottom:2px solid var(--dai);padding:6px 0 0;margin:0 0 12px;overflow-x:auto;min-height:40px}.tabbar button{font:inherit;font-size:13px;border:1px solid #d4dde4;border-bottom:none;background:#eef2f5;color:#456;padding:7px 18px;border-radius:6px 6px 0 0;cursor:pointer;white-space:nowrap}.tabbar button:hover,.tabbar button:focus{background:#e3eaef}.tabbar button.active{background:var(--dai);color:#fff;font-weight:700;border-color:var(--dai)}
@media(max-width:900px){body{padding:12px}.funclist{min-width:1100px}.panel{overflow-x:auto}.detail-grid{grid-template-columns:100px minmax(0,1fr)}}@media print{body{padding:0;font-size:10px}thead th{position:static}tr,.function-card,.contract-card,.diagram{break-inside:avoid}thead{display:table-header-group}.tabbar,.toolbar{display:none}.panel{display:block!important}.panel+.panel{page-break-before:always}.diagram-svg{min-width:0}}
""".strip()


SCRIPT = """
<script>
(function(){
  var tabs=[].slice.call(document.querySelectorAll('[role="tab"]'));
  var panels=[].slice.call(document.querySelectorAll('[role="tabpanel"]'));
  function show(id,focus){panels.forEach(function(p){p.classList.toggle('active',p.id===id);});tabs.forEach(function(t){var on=t.getAttribute('aria-controls')===id;t.classList.toggle('active',on);t.setAttribute('aria-selected',on?'true':'false');t.tabIndex=on?0:-1;});if(focus){var tab=tabs.find(function(t){return t.getAttribute('aria-controls')===id;});if(tab){tab.focus();}}}
  function revealHash(scroll){if(!window.location.hash)return;var id=decodeURIComponent(window.location.hash.slice(1));var target=document.getElementById(id);if(!target)return;var panel=target.closest('[role="tabpanel"]');if(panel)show(panel.id);if(scroll)setTimeout(function(){target.scrollIntoView();},0);}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){show(t.getAttribute('aria-controls'));});t.addEventListener('keydown',function(e){var n=i;if(e.key==='ArrowRight')n=(i+1)%tabs.length;else if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;else if(e.key==='Home')n=0;else if(e.key==='End')n=tabs.length-1;else return;e.preventDefault();show(tabs[n].getAttribute('aria-controls'),true);});});
  document.querySelectorAll('[data-detail]').forEach(function(a){a.addEventListener('click',function(){show('panel-details');setTimeout(function(){var el=document.getElementById('detail-'+a.dataset.detail);if(el)el.scrollIntoView();},0);});});
  document.querySelectorAll('a.ref-link').forEach(function(a){a.addEventListener('click',function(){setTimeout(function(){revealHash(true);},0);});});
  window.addEventListener('hashchange',function(){revealHash(true);});
  var query=document.getElementById('filter-query'),status=document.getElementById('filter-status'),execution=document.getElementById('filter-execution');function filter(){var q=(query.value||'').toLowerCase();document.querySelectorAll('#function-body tr').forEach(function(row){var ok=(!q||row.dataset.search.indexOf(q)>=0)&&(!status.value||row.dataset.status===status.value)&&(!execution.value||row.dataset.execution===execution.value);row.hidden=!ok;});}[query,status,execution].forEach(function(el){el.addEventListener('input',filter);});
  revealHash(false);
})();
</script>
""".strip()


def render(config, spec_text=None, allow_draft=True, level="auto", feature_dir=None):
    """Render v2/v3 design data and return ``(html, quality_report)``.

    ``level`` only selects the requested document gate/display level; it never fills
    missing technical design data. ``feature_dir`` is forwarded to the v3 validator
    when supported and is otherwise used by the CLI to resolve source artifacts.
    """
    try:
        schema_version = int(config.get("schema_version", 1))
    except (TypeError, ValueError):
        schema_version = 1
    if schema_version >= 3:
        cfg = copy.deepcopy(config)
        for key in ("interfaces", "traceability", "source_catalog", "decisions", "open_questions"):
            cfg.setdefault(key, [])
    else:
        cfg = normalize_config(config)
    items = []
    if spec_text is not None:
        parameter_names = validate_design.__code__.co_varnames[: validate_design.__code__.co_argcount]
        validator_kwargs = {}
        if "feature_dir" in parameter_names:
            validator_kwargs["feature_dir"] = feature_dir
        if "level" in parameter_names:
            validator_kwargs["level"] = level
        cfg, report, items = validate_design(spec_text, config, **validator_kwargs)
        if report["errors"] and not allow_draft:
            raise ValueError("設計品質ゲートに失敗しました:\n- " + "\n- ".join(report["errors"]))
    else:
        report = copy.deepcopy(cfg.get("report") or cfg.get("quality") or {})
        report.setdefault("status", "draft")
        report.setdefault("blocking_error_count", 0)
        report.setdefault("warning_count", 1)
        report.setdefault("unresolved_count", len(cfg.get("open_questions", [])))
        report.setdefault(
            "unsubstantiated_count",
            sum(1 for _, _, _, function in flatten_functions(cfg) if not function.get("source_refs")),
        )
        report.setdefault("coverage", {})
        report.setdefault("errors", [])
        report.setdefault("warnings", ["spec.md未指定のため要求網羅性は未検証です"])
        if schema_version >= 3:
            report.setdefault(
                "readiness",
                {key: {"status": "not-evaluated", "warnings": ["spec.md未指定"]} for key in READINESS_LABELS},
            )
            report.setdefault("document_status", "blocked")
    effective_level = _resolve_level(cfg, level)
    if schema_version >= 3:
        report.setdefault("readiness", {key: {"status": "not-evaluated"} for key in READINESS_LABELS})
        report.setdefault("document_status", effective_level if not report.get("errors") else "blocked")
    item_by_id = {item["id"]: item for item in items}
    for item in cfg.get("source_catalog", []) or []:
        if item.get("id"):
            item_by_id.setdefault(item["id"], item)
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
    if schema_version >= 3:
        sheets = [("review", "レビュー概要", _review(cfg, report, effective_level))]
        if _has_architecture_view(cfg):
            sheets.append(("architecture", "システム構成", _architecture(cfg)))
        sheets.extend(
            [
                ("functions", "機能一覧", main),
                ("details", "機能詳細", _details(cfg, interfaces)),
            ]
        )
        if cfg.get("workflows") or cfg.get("state_models"):
            sheets.append(("flows", "フロー・状態", _flows(cfg)))
        if cfg.get("entities"):
            sheets.append(("data", "データモデル", _data_model(cfg)))
        if cfg.get("interfaces"):
            sheets.append(("interfaces", "インターフェース・契約", _contracts(cfg)))
        sheets.extend(
            [
                ("quality", "品質・検証・リスク", _quality_v3(cfg, report)),
                ("traceability", "トレーサビリティ", _traceability(cfg, item_by_id)),
            ]
        )
        if cfg.get("delivery_summary"):
            sheets.append(("delivery", "実装計画要約", _delivery(cfg)))
    else:
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


def _resolve_existing_path(value, roots):
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_absolute() and candidate.exists():
        return candidate
    for root in roots:
        if root is None:
            continue
        resolved = Path(root) / candidate
        if resolved.exists():
            return resolved
    return candidate if candidate.exists() else None


def _configured_spec(cfg):
    source = cfg.get("source") or {}
    if source.get("spec"):
        return source.get("spec")
    for artifact in source.get("artifacts", []) or []:
        if isinstance(artifact, str):
            path = artifact
            artifact_type = ""
        else:
            path = artifact.get("path") or artifact.get("file")
            artifact_type = artifact.get("type", "")
        if artifact_type == "spec" or (path and Path(path).name.lower() == "spec.md"):
            return path
    return None


def main():
    parser = argparse.ArgumentParser(description="検証済み基本設計データから自己完結HTMLを生成")
    parser.add_argument("config", help="v2/v3設計データ (*.design.json)")
    parser.add_argument("--spec", help="要求の正本 spec.md。確定版生成では必須")
    parser.add_argument("--feature-dir", help="Spec Kit featureディレクトリ。spec.mdと成果物参照の解決基準")
    parser.add_argument(
        "--level",
        choices=("auto", "functional-design", "implementation-ready"),
        default="auto",
        help="資料レベル。autoはdesign.jsonのdocument_levelを使用",
    )
    parser.add_argument("-o", "--output", help="出力HTML")
    parser.add_argument("--allow-draft", action="store_true", help="品質エラーがあってもレビュー用ドラフトを生成")
    args = parser.parse_args()

    feature_dir = Path(args.feature_dir) if args.feature_dir else None
    if feature_dir is not None and not feature_dir.is_dir():
        parser.error(f"--feature-dir が存在しないディレクトリです: {feature_dir}")
    # A feature-relative CLI invocation must not be shadowed by an unrelated
    # same-named file in the caller's current directory.
    primary_roots = [feature_dir, Path.cwd()] if feature_dir is not None else [Path.cwd()]
    config_path = _resolve_existing_path(args.config, primary_roots)
    if config_path is None or not config_path.is_file():
        parser.error(f"設計データが見つかりません: {args.config}")
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    spec_path = _resolve_existing_path(
        args.spec,
        [*primary_roots, config_path.parent],
    ) if args.spec else None
    if args.spec and spec_path is None:
        parser.error(f"--spec が見つかりません: {args.spec}")
    if spec_path is None and feature_dir is not None:
        spec_path = _resolve_existing_path("spec.md", [feature_dir])
    if spec_path is None:
        spec_path = _resolve_existing_path(_configured_spec(cfg), [feature_dir, config_path.parent, Path.cwd()])
    if int(cfg.get("schema_version", 1) or 1) >= 2 and spec_path is None and not args.allow_draft:
        parser.error("確定版生成には --spec が必要です。未検証出力は --allow-draft を明示してください")
    schema_version = int(cfg.get("schema_version", 1) or 1)
    if schema_version >= 3 and feature_dir is None and spec_path is not None:
        feature_dir = spec_path.parent
    if schema_version >= 3 and feature_dir is not None and spec_path is not None:
        configured_spec = _configured_spec(cfg)
        if configured_spec:
            configured_path = Path(configured_spec)
            expected_spec = configured_path if configured_path.is_absolute() else feature_dir / configured_path
            if expected_spec.resolve() != spec_path.resolve() and not args.allow_draft:
                parser.error(
                    "--spec とsource.artifactsのtype=spec pathが一致しません: "
                    f"{spec_path} != {expected_spec}"
                )
    spec_text = spec_path.read_text(encoding="utf-8") if spec_path else None
    try:
        html_text, report = render(
            cfg,
            spec_text,
            allow_draft=args.allow_draft,
            level=args.level,
            feature_dir=feature_dir,
        )
    except ValueError as exc:
        parser.exit(1, str(exc) + "\n")
    output = _output_path(cfg, config_path, args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html_text, encoding="utf-8")
    count = len(flatten_functions(normalize_config(cfg)))
    status = report.get("document_status") or report.get("status", "draft")
    print(f"saved {output} (機能 {count}件 / 資料状態 {status} / 警告 {report.get('warning_count', 0)}件)")


if __name__ == "__main__":
    main()
