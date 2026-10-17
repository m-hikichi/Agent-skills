#!/usr/bin/env python3
"""Render three Markdown documents and a self-contained review HTML."""

from __future__ import annotations

import argparse
import copy
import html
import json
import os
import re
import tempfile
import sys
from pathlib import Path
from typing import Any

from document_model import SCHEMA_VERSION, evaluate_model
from schema_validation import require_valid_model
from test_quality import FIELD_LABELS as TEST_FIELD_LABELS, missing_test_fields
from review_integrity import review_issue


WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}

DISPLAY_VALUES = {
    "user-story": "利用者の目的", "acceptance-scenario": "受入条件", "functional-requirement": "機能要件",
    "non-functional-requirement": "非機能要件", "edge-case": "例外・境界条件", "success-criterion": "達成基準",
    "assumption": "前提条件", "clarification": "確認事項", "out-of-scope": "対象外", "other": "その他",
    "current": "今回の対象", "future": "将来対応", "retired": "廃止", "blocked": "確認待ち",
    "planned": "未実施（計画中）", "open": "未解決", "resolved": "解決済み",
    "positive": "正常系", "alternative": "代替経路", "negative": "異常系", "boundary": "境界値・例外",
    "nfr": "非機能", "contract": "契約", "state": "状態遷移", "normal": "通常",
    "logical-acceptance": "要件確認テスト（実装方式に依存しない確認）", "unit": "単体", "integration": "結合", "e2e": "E2E（全体）",
    "performance": "性能", "security": "セキュリティ", "operational": "運用", "manual-review": "目視確認",
    "specified": "入力資料に明記", "derived": "入力資料から導出", "confirmed": "レビュー確認済み",
    "unspecified": "未設定（要確認）", "draft": "レビュー用", "publish": "公開用",
    "draft-ready": "レビュー可能", "publishable": "公開可能", "passed": "問題なし", "failed": "要対応",
    "spec-only": "仕様書のみ", "plan-enriched": "計画・設計資料を含む",
}

FIELD_LABELS = {
    "id": "ID", "kind": "種別", "statement": "内容", "status": "状態", "priority": "優先度",
    "parent_id": "上位要件", "basis": "作成根拠", "source_refs": "根拠箇所", "body": "説明",
    "why": "目的・理由", "independent_test": "単独確認方法", "name": "名称", "summary": "概要",
    "actors": "利用者・関係者", "trigger": "開始条件", "inputs": "入力", "outputs": "出力",
    "preconditions": "事前条件", "postconditions": "完了条件", "business_rules": "業務ルール",
    "exceptions": "例外", "rationale": "判断理由", "title": "名称", "type": "テスト種別",
    "level": "テスト段階", "steps": "操作・入力", "test_data": "テストデータ",
    "expected_result": "期待結果", "automation_status": "自動化状況", "profile": "用途",
    "report": "品質診断", "change_impact": "変更影響", "errors": "要対応事項", "warnings": "注意事項",
    "metrics": "件数", "blocking_errors": "公開を妨げる問題数", "axes": "確認項目",
    "source_integrity": "入力資料の整合性", "requirements_quality": "要件の品質",
    "function_coverage": "機能への反映", "test_coverage": "テストへの反映",
    "cross_artifact_consistency": "資料間の整合性", "render_reproducibility": "再生成の一致",
}


def display_value(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {FIELD_LABELS.get(child_key, child_key): display_value(child, child_key) for child_key, child in value.items()}
    if isinstance(value, list):
        return [display_value(item, key) for item in value]
    if isinstance(value, str):
        if value == "unspecified":
            return {"priority": "優先度を決める必要あり", "automation_status": "自動化するか未決定", "trigger": "開始条件は入力資料に記載なし"}.get(key, DISPLAY_VALUES[value])
        if key == "priority" and re.fullmatch(r"P[1-9]\d*", value):
            return {"P1": "最優先（P1）", "P2": "高（P2）", "P3": "通常（P3）"}.get(value, f"優先度 {value}")
        if key in {"kind", "status", "type", "level", "basis", "automation_status", "profile", "mode"}:
            return DISPLAY_VALUES.get(value, value)
    return value


def reading_guide_markdown() -> list[str]:
    return [
        "## この文書の見方", "",
        "- **今回の対象**: 今回実装・確認する項目です。",
        "- **未設定（要確認）**: 入力資料だけでは決められず、レビューで確認が必要な項目です。",
        "- **US／AC／FR／SC／EC**: 利用者の目的／受入条件／機能要件／達成基準／例外・境界条件を表します。",
        "- **FNC／TST**: 機能／テストを表します。IDをたどると要件からテストまで追跡できます。",
        "- **Given／When／Then**: 事前条件／操作／期待結果を表します。`spec.md#L16`は元資料の16行目という意味です。", "",
    ]


def reading_guide_html() -> str:
    return "<aside><h3>この資料の見方</h3><ul><li><strong>今回の対象</strong>: 今回実装・確認する項目です。</li><li><strong>未設定（要確認）</strong>: 入力資料だけでは決められない項目です。</li><li><strong>US／AC／FR／SC／EC</strong>: 利用者の目的／受入条件／機能要件／達成基準／例外・境界条件です。</li><li><strong>FNC／TST</strong>: 機能／テストです。IDから関係を追跡できます。</li><li><strong>Given／When／Then</strong>: 事前条件／操作／期待結果です。</li></ul></aside>"


def display_title(value: str) -> str:
    return re.sub(r"^Feature Specification:\s*", "", value, flags=re.I).strip()


def display_source_ref(value: str) -> str:
    match = re.fullmatch(r"(.+?)#L(\d+)", value)
    return f"{match.group(1)} {match.group(2)}行目" if match else value


def question_action(return_to: str) -> str:
    return {
        "traceability-review": "要件と機能の対応をレビューする",
        "speckit.clarify": "元の仕様を確認して具体化する",
        "speckit.plan": "設計資料を確認して追記する",
        "speckit.analyze": "資料間の矛盾を確認する",
        "semantic-review": "別担当者が入力資料と照合する",
    }.get(return_to, "担当者を決めて内容を確認する")


def pending_content_review(model: dict[str, Any], item_ids: set[str]) -> bool:
    if review_issue(model):
        return True
    questions = model.get("open_questions", [])
    if not any(question.get("return_to") == "semantic-review" for question in questions):
        return True
    for question in questions:
        resolution = question.get("resolution")
        completed = question.get("status") == "resolved" and isinstance(resolution, str) and bool(resolution.strip()) and bool(question.get("source_refs"))
        affected = set(question.get("affected_ids", []))
        if not completed and (not affected or affected.intersection(item_ids) or question.get("return_to") == "semantic-review"):
            return True
    return False


def test_readiness(test: dict[str, Any], model: dict[str, Any] | None = None) -> tuple[str, list[str]]:
    missing = [TEST_FIELD_LABELS[key] for key in missing_test_fields(test)]
    if missing:
        return "要具体化", missing
    if model:
        related = {test.get("id", "")}
        related.update(link.get("from_id") for link in model.get("links", []) if link.get("to_id") == test.get("id") and link.get("type") in {"function-to-test", "requirement-to-test"})
        if pending_content_review(model, related) or any(function.get("id") in related and function.get("basis") == "derived" for function in model.get("functions", [])):
            return "内容レビュー待ち", []
    return "実施可能", []


def review_state(model: dict[str, Any]) -> dict[str, int | str]:
    axes = model.get("report", {}).get("axes", {})
    errors = sum(len(axis.get("errors", [])) for axis in axes.values())
    warnings = sum(len(axis.get("warnings", [])) for axis in axes.values())
    questions = sum(item.get("status", "open") == "open" for item in model.get("open_questions", []))
    incomplete = sum(test_readiness(test, model)[0] == "要具体化" for test in model.get("test_cases", []))
    waiting = sum(test_readiness(test, model)[0] != "実施可能" for test in model.get("test_cases", []))
    stage = "要対応" if errors else "レビュー中" if warnings or questions or waiting else "レビュー完了"
    return {"errors": errors, "warnings": warnings, "questions": questions, "incomplete": incomplete, "waiting": waiting, "stage": stage}


def review_summary_markdown(model: dict[str, Any], purpose: str, related_questions: list[dict[str, Any]] | None = None) -> list[str]:
    state = review_state(model)
    questions = int(state["questions"])
    related = questions if related_questions is None else sum(item.get("status", "open") == "open" for item in related_questions)
    incomplete = int(state["incomplete"])
    needs_review = state["stage"] != "レビュー完了"
    return [
        "## この資料で分かること", "", purpose, "",
        "## 現在の確認状況", "",
        f"- **文書の段階**: {state['stage']}",
        f"- **収録件数**: 要件 {len(model.get('requirements', []))}件／機能 {len(model.get('functions', []))}件／テスト {len(model.get('test_cases', []))}件",
        f"- **残っている確認**: この資料に関係する未決事項 {related}件（全体 {questions}件）／要具体化テスト {incomplete}件",
        f"- **自動チェック**: 要対応 {state['errors']}件／確認推奨 {state['warnings']}件",
        "- **詳しい内容**: 同時生成されたレビューHTMLの「品質診断の詳細」を確認してください。" if state["errors"] or state["warnings"] else "- **詳しい内容**: 自動チェックの指摘はありません。",
        "- **次にすること**: 未決事項・要具体化テスト・自動チェックの指摘を確認し、別担当者のレビュー後に公開版とします。" if needs_review else "- **次にすること**: 公開前の最終承認を行います。",
        "",
    ]


def change_impact_markdown(model: dict[str, Any]) -> list[str]:
    impacts = model.get("change_impact", [])
    lines = ["", "## 変更による影響", ""]
    if not impacts:
        return [*lines, "現在、前回版からの変更影響はありません。", ""]
    for item in impacts:
        lines.append(f"- **{md_cell(item.get('id'))}**: {md_cell(item.get('impact') or item.get('change'))}")
    lines.append("")
    return lines


def readable_requirement(item: dict[str, Any]) -> str:
    statement = item.get("statement", "")
    match = re.search(r"Given\s+(.+?)[,;、]?\s*When\s+(.+?)[,;、]?\s*Then\s+(.+)", statement, re.I)
    if not match:
        return re.sub(r"\binvalid\b", "文字列『invalid』（不正形式の例）", statement, flags=re.I)
    operation = re.sub(r"\binvalid\b", "文字列『invalid』（不正形式の例）", match.group(2), flags=re.I)
    return f"事前条件: {match.group(1).strip(' ,;、')}\n操作: {operation.strip(' ,;、')}\n期待結果: {match.group(3).strip()}"


def function_review_status(model: dict[str, Any], function_id: str) -> str:
    function = next((item for item in model.get("functions", []) if item.get("id") == function_id), None)
    linked_ids = {link.get("from_id") for link in model.get("links", []) if link.get("type") == "requirement-to-function" and link.get("to_id") == function_id}
    current_requirements = [item for item in model.get("requirements", []) if item.get("kind") in REQUIREMENT_DISPLAY_ORDER and item.get("status") == "current"]
    if function and function.get("basis") == "derived" and len(linked_ids) == 1 and len(current_requirements) > 1:
        requirement = next((item for item in current_requirements if item.get("id") in linked_ids), None)
        if requirement and re.sub(r"\s+", " ", str(function.get("name", "")).strip()) == re.sub(r"\s+", " ", str(requirement.get("statement", "")).strip()):
            return "候補（1要件を独立機能にするかレビューが必要）"
    if (function and function.get("basis") == "derived") or pending_content_review(model, linked_ids | {function_id}):
        return "候補（対応関係のレビューが必要）"
    return "確認済み"


def human_test_title(test: dict[str, Any]) -> str:
    title = test.get("title", "")
    return re.sub(r"\s+[—-]\s+(?:US|AC|FR|SC|EC|REQ)-\d+\s*$", "", title, flags=re.I)


def display_steps(steps: list[str]) -> list[str]:
    return [re.sub(r"\binvalid\b", "文字列『invalid』（不正形式の例）", step, flags=re.I) for step in display_value(steps, "steps")]


def id_guide_markdown() -> list[str]:
    return ["> **IDの見方:** US=利用者の目的、AC=受入条件、FR=機能要件、SC=達成基準、EC=例外、OOS=対象外、FNC=機能、TST=テスト、Q=確認事項", ""]


def questions_markdown(questions: list[dict[str, Any]], empty_message: str) -> list[str]:
    """Group repeated review questions so beginners can see the work by topic."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in questions:
        if item.get("status", "open") == "open":
            grouped.setdefault(item.get("return_to", ""), []).append(item)
    if not grouped:
        return [empty_message]
    lines = ["> 同じ種類の確認をまとめています。見出しを開くと対象IDと確認内容を確認できます。", ""]
    for return_to, items in grouped.items():
        action = question_action(return_to)
        lines.extend([
            f"<details><summary>{md_cell(action)}（{len(items)}件）</summary>", "",
            "| 確認ID | 関係するID | 確認内容 |", "|---|---|---|",
        ])
        for item in items:
            lines.append("| " + " | ".join(md_cell(value) for value in (
                item.get("id"), item.get("affected_ids", []), item.get("question")
            )) + " |")
        lines.extend(["", "</details>", ""])
    return lines


def friendly_diagnostic(message: str) -> str:
    exact = {
        f"schema_version must be {SCHEMA_VERSION}": f"正本データの形式バージョンを {SCHEMA_VERSION} にしてください。",
        "exactly one spec source is required": "基準となる spec.md を1ファイルだけ指定してください。",
        "IDs must be present and globally unique": "すべての項目に、資料全体で重複しないIDが必要です。",
        "identity_registry IDs and source keys must be unique": "ID管理表に重複があります。IDと元資料の識別子を確認してください。",
        "duplicate links are not allowed": "要件・機能・テスト間に同じ関連付けが重複しています。",
        "open questions must be resolved before publish": "未決事項が残っているため、公開版にはできません。",
        "independent semantic review record is required before publish": "入力資料と3資料を照合した独立レビューの記録が必要です。",
        "review attestation is missing": "この資料の版に対するレビュー記録がありません。独立レビュー後に確認した版を記録してください。",
        "review attestation is incomplete": "レビュー担当者・確認範囲・確認した版の記録が不足しています。",
        "review attestation is stale; content changed after review": "レビュー後に資料の内容が変更されています。変更箇所を再レビューし、確認した版を記録してください。",
        "source files were not verified during rendering": "入力フォルダーが未指定のため、元資料の変更とチェックリストは未照合です。公開前に元資料を指定して再生成してください。",
    }
    if message in exact:
        return exact[message]
    match = re.fullmatch(r"(TST-\d+): concrete test operation/expectation is unresolved(?: \(([^)]+)\))?", message)
    if match:
        fields = "・".join(TEST_FIELD_LABELS.get(key.strip(), key.strip()) for key in match.group(2).split(",")) if match.group(2) else "操作・入力または期待結果"
        return f"{match.group(1)}: {fields}を具体化してください。"
    match = re.fullmatch(r"unclassified section: (.+)", message)
    if match:
        return f"自動分類できなかった情報があります: {match.group(1)}"
    patterns = [
        (r"(.+): unchecked quality item", r"\1: 品質チェック項目が未確認です。"),
        (r"(.+): unresolved requirement", r"\1: 内容が未決の要件です。"),
        (r"(.+): no function coverage", r"\1: 対応する機能がありません。"),
        (r"(.+): derived function mirrors a single requirement", r"\1: 1つの要件文をそのまま機能にしているため、機能のまとめ方を確認してください。"),
        (r"(.+): derived function boundary requires confirmation", r"\1: 自動生成した機能候補です。機能の分け方・まとめ方をレビューして確定してください。"),
        (r"(.+): current function has no current requirement", r"\1: 今回の対象となる要件が紐づいていません。対象外・廃止済み要件だけでは対応済みにできません。"),
        (r"(.+): no test through a current function", r"\1: 今回の対象機能を経由して検証するテストがありません。将来・廃止済み機能は対応済みに数えません。"),
        (r"(.+): resolved question requires resolution and source_refs", r"\1: 解決済みにするには、判断理由と元資料の根拠箇所を記録してください。"),
        (r"(.+): no direct requirement link", r"\1: このテストで確認する要件が紐づいていません。"),
        (r"(.+): requirement link is inconsistent with target functions", r"\1: テストの対象要件が、どの対象機能にも対応していません。"),
        (r"(.+): requirement link is inconsistent with (.+)", r"\1: 対象機能 \2 と共通する要件がありません。紐づけを確認してください。"),
        (r"(.+): no test coverage", r"\1: 対応するテストがありません。"),
        (r"(.+): current requirement has no direct test", r"\1: 今回対象の要件に直接対応するテストがありません。"),
        (r"(.+): orphan function", r"\1: 対応する要件がない機能です。"),
        (r"(.+): orphan test", r"\1: 対応する機能がないテストです。"),
        (r"(.+): steps/expected_result required", r"\1: 操作・入力と期待結果が必要です。"),
        (r"(.+): statement/source_refs required", r"\1: 内容と元資料の場所が必要です。"),
        (r"source missing: (.+)", r"入力ファイルが見つかりません: \1"),
        (r"source fingerprint is stale: (.+)", r"入力ファイルが正本作成後に変更されています: \1"),
    ]
    for pattern, replacement in patterns:
        if re.fullmatch(pattern, message):
            return re.sub(pattern, replacement, message)
    if re.search(r"[A-Za-z]{3,}", message):
        return "自動検査で、利用者向けに未翻訳の技術的な指摘が見つかりました。担当エンジニアが正本データを確認してください。"
    return message


REQUIREMENT_DISPLAY_ORDER = {
    "user-story": 0, "acceptance-scenario": 1, "functional-requirement": 2,
    "non-functional-requirement": 3, "edge-case": 4, "success-criterion": 5,
    "assumption": 6, "clarification": 7, "out-of-scope": 8, "other": 9,
}


def ordered_requirements(model: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(model.get("requirements", []), key=lambda item: (REQUIREMENT_DISPLAY_ORDER.get(item.get("kind"), 99), item.get("id", "")))


def safe_stem(value: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", value).strip(" .")
    value = re.sub(r"\s+", "-", value)
    if not value or value.split('.')[0].upper() in WINDOWS_RESERVED:
        value = f"feature-{value.lower()}" if value else "feature"
    return value[:120].rstrip(' .')


def markdown_details(model: dict[str, Any], collection: str) -> str:
    """Lossless, escaped review details complement the compact summary tables."""
    lines = ["", "## 詳細・根拠", ""]
    for item in model.get(collection, []):
        lines.extend([f"### {md_cell(item.get('id', '項目'))}", ""])
        for key, value in sorted(item.items()):
            value = display_value(value, key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True)
            lines.append(f"- {md_cell(FIELD_LABELS.get(key, key))}: {md_cell(value)}")
        lines.append("")
    lines.extend(["## 文書状態・変更影響", ""])
    for key in ('profile', 'report', 'change_impact'):
        localized = display_value(model.get(key), key)
        lines.extend([f"- {FIELD_LABELS.get(key, key)}: {md_cell(json.dumps(localized, ensure_ascii=False, sort_keys=True))}", ""])
    return "\n".join(lines)


def html_details(model: dict[str, Any], collection: str) -> str:
    result = []
    for item in model.get(collection, []):
        fields = []
        for key, value in sorted(item.items()):
            if value in (None, "", [], {}):
                continue
            value = display_value(value, key)
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True)
            fields.append(f'<dt>{h(FIELD_LABELS.get(key, key))}</dt><dd style="white-space:pre-wrap">{h(value)}</dd>')
        result.append(f'<details class="item-details"><summary>{h(item.get("id", item.get("path", "項目")))} の補足情報</summary><dl>{"".join(fields)}</dl></details>')
    return ''.join(result)


def index_links(model: dict[str, Any]) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, list[str]]]:
    req_fn: dict[str, list[str]] = {}
    fn_req: dict[str, list[str]] = {}
    fn_test: dict[str, list[str]] = {}
    for link in model.get("links", []):
        if link.get("type") == "requirement-to-function":
            req_fn.setdefault(link["from_id"], []).append(link["to_id"])
            fn_req.setdefault(link["to_id"], []).append(link["from_id"])
        elif link.get("type") == "function-to-test":
            fn_test.setdefault(link["from_id"], []).append(link["to_id"])
    for mapping in (req_fn, fn_req, fn_test):
        for key in mapping:
            mapping[key] = sorted(set(mapping[key]))
    return req_fn, fn_req, fn_test


def md_cell(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, list):
        value = ", ".join(str(item) for item in value)
    text = html.escape(str(value), quote=False).replace("|", "\\|").replace("\n", "<br>").strip()
    return text or "—"


def requirements_markdown(model: dict[str, Any]) -> str:
    req_fn, _, _ = index_links(model)
    context = model.get("context", {})
    lines = [
        f"# {md_cell(display_title(model['title']))} — 要件定義書",
        "",
        "> この文書は管理用の正本データから自動生成されています。直接編集しないでください。",
        "",
        *review_summary_markdown(model, "利用者が何を実現したいか、必要な振る舞い、例外、達成基準を確認する資料です。"),
        *reading_guide_markdown(),
        "## 対象機能の概要",
        "",
        md_cell(context.get("overview") or "正本に概要の記載がありません。"),
        "",
        "## 利用者の目的",
        "",
    ]
    stories = [item for item in model.get("requirements", []) if item.get("kind") == "user-story"]
    if stories:
        for story in stories:
            lines.append(f"- **{md_cell(story['id'])}**: {md_cell(story['statement'])}（優先度: {md_cell(display_value(story.get('priority'), 'priority'))}）")
    else:
        lines.append("利用者の目的は入力資料に記載されていません。")
    lines.extend([
        "",
        "## 要件一覧",
        "",
        *id_guide_markdown(),
        "| 要件ID | 種別 | 内容 | 対応機能 | 対応範囲 | 元資料 |",
        "|---|---|---|---|---|---|",
    ])
    for req in ordered_requirements(model):
        lines.append("| " + " | ".join(md_cell(value) for value in (
            req.get("id"), display_value(req.get("kind"), "kind"), readable_requirement(req), req_fn.get(req.get("id"), []), display_value(req.get("status"), "status"), [display_source_ref(ref) for ref in req.get("source_refs", [])]
        )) + " |")
    lines.extend(["", "## 主要エンティティ", ""])
    entities = context.get("key_entities", [])
    if entities:
        lines.extend(f"- {md_cell(item['name'])}（{md_cell(item['source_ref'])}）" for item in entities)
    else:
        lines.append("- 正本に主要エンティティの記載はありません。")
    lines.extend(["", "## 未決事項", ""])
    questions = model.get("open_questions", [])
    lines.extend(questions_markdown(questions, "未決事項はありません。"))
    lines.extend(["", "## 未分類の補足成果物", ""])
    extras = model.get("unclassified", [])
    if extras:
        for item in extras:
            lines.extend([f"### {md_cell(item.get('title'))}", "", f"- 根拠: {md_cell(item.get('source_ref'))}", f"- 理由: {md_cell(item.get('reason'))}", "", "```text", str(item.get("content", "（本文はsourceを参照）")).replace("```", "` ` `"), "```", ""])
    else:
        lines.append("未分類の補足成果物はありません。")
    lines.extend(change_impact_markdown(model))
    return "\n".join(lines) + "\n"


def functions_markdown(model: dict[str, Any]) -> str:
    _, fn_req, fn_test = index_links(model)
    function_ids = {fn["id"] for fn in model.get("functions", [])}
    relevant = [item for item in model.get("open_questions", []) if item.get("status", "open") == "open" and (item.get("return_to") == "semantic-review" or any(identity in function_ids for identity in item.get("affected_ids", [])))]
    lines = [
        f"# {md_cell(display_title(model['title']))} — 機能一覧",
        "",
        "> この文書は管理用の正本データから自動生成されています。直接編集しないでください。",
        "",
        *review_summary_markdown(model, "要件を実現するために、システムが提供する機能と、その確認テストを整理した資料です。", relevant),
        *reading_guide_markdown(),
        "## 対象機能の概要", "", md_cell(model.get('context', {}).get('overview') or "概要は入力資料に記載されていません。"), "",
        "> **確認してください:** 「候補」と表示された機能は、自動抽出した仮の分け方です。同じ業務を表す機能が重複していないかレビューしてください。",
        "",
        "## 機能一覧", "",
        *id_guide_markdown(),
        "| 機能ID | 機能名 | 対応要件 | 対応テスト | 優先度 | 確認状況 |",
        "|---|---|---|---|---|---|",
    ]
    for fn in model.get("functions", []):
        lines.append("| " + " | ".join(md_cell(value) for value in (
            fn.get("id"), fn.get("name"), fn_req.get(fn.get("id"), []), f"{len(fn_test.get(fn.get('id'), []))}件", display_value(fn.get("priority"), "priority"), function_review_status(model, fn.get("id", ""))
        )) + " |")
    for fn in model.get("functions", []):
        lines.extend([
            "",
            f"## {md_cell(fn['id'])} {md_cell(fn['name'])}",
            "",
            f"- **何をする機能か**: {md_cell(fn.get('summary'))}",
            f"- **確認状況**: {md_cell(function_review_status(model, fn['id']))}",
            f"- 対応要件: {', '.join(fn_req.get(fn['id'], [])) or 'なし'}",
            f"- 対応テスト: {', '.join(fn_test.get(fn['id'], [])) or 'なし'}",
            f"- 開始条件: {md_cell(display_value(fn.get('trigger') or '未確定', 'trigger'))}",
            f"- 入力: {md_cell(display_value(fn.get('inputs') or ['入力資料に記載なし'], 'inputs'))}",
            f"- 出力: {md_cell(display_value(fn.get('outputs') or ['入力資料に記載なし'], 'outputs'))}",
            f"- 業務ルール: {md_cell(display_value(fn.get('business_rules') or ['入力資料に記載なし'], 'business_rules'))}",
            f"- 例外: {md_cell(display_value(fn.get('exceptions') or ['入力資料に記載なし'], 'exceptions'))}",
            f"- 作り方: {display_value(fn.get('basis', 'unspecified'), 'basis')}（{md_cell(fn.get('rationale'))}）",
            f"- 元資料: {', '.join(display_source_ref(ref) for ref in fn.get('source_refs', [])) or 'なし'}",
        ])
    lines.extend(["", "## 要確認事項", ""])
    lines.extend(questions_markdown(relevant, "機能に関する要確認事項はありません。"))
    lines.extend(change_impact_markdown(model))
    return "\n".join(lines) + "\n"


def tests_markdown(model: dict[str, Any]) -> str:
    _, fn_req, _ = index_links(model)
    test_fn: dict[str, list[str]] = {}
    test_req: dict[str, list[str]] = {}
    for link in model.get("links", []):
        if link.get("type") == "function-to-test":
            test_fn.setdefault(link["to_id"], []).append(link["from_id"])
        elif link.get("type") == "requirement-to-test":
            test_req.setdefault(link["to_id"], []).append(link["from_id"])
    test_ids = {test["id"] for test in model.get("test_cases", [])}
    relevant_questions = [item for item in model.get("open_questions", []) if item.get("status", "open") == "open" and (item.get("return_to") == "semantic-review" or any(identity in test_ids for identity in item.get("affected_ids", [])))]
    incomplete = sum(test_readiness(test, model)[0] == "要具体化" for test in model.get("test_cases", []))
    lines = [
        f"# {md_cell(display_title(model['title']))} — テスト仕様書{'（レビュー中）' if incomplete else ''}",
        "",
        "> この文書は管理用の正本データから自動生成されています。実施結果ではなく、レビュー用のテスト項目一覧です。",
        "",
        *review_summary_markdown(model, "要件を満たすことを、どの条件で、どのように操作し、何を確認するか整理した資料です。", relevant_questions),
        *reading_guide_markdown(),
        "> **注意:** 「要具体化」のテストは、そのままでは実施できません。不足している条件を元の仕様へ追記してください。",
        "",
        "## テスト一覧", "",
        *id_guide_markdown(),
        "| テストID | 確認すること | 対象機能／要件 | テスト種別 | 操作・入力 | 期待結果 | 実施可否 |",
        "|---|---|---|---|---|---|---|",
    ]
    for test in model.get("test_cases", []):
        readiness, missing = test_readiness(test, model)
        lines.append("| " + " | ".join(md_cell(value) for value in (
            test.get("id"), human_test_title(test), f"機能: {', '.join(sorted(test_fn.get(test.get('id'), [])))}\n要件: {', '.join(sorted(test_req.get(test.get('id'), [])))}", display_value(test.get("type"), "type"), display_steps(test.get("steps", [])), display_value(test.get("expected_result"), "expected_result"), readiness + (f"（不足: {'、'.join(missing)}）" if missing else "")
        )) + " |")
    for test in model.get("test_cases", []):
        readiness, missing = test_readiness(test, model)
        lines.extend([
            "",
            f"## {md_cell(human_test_title(test))}（{md_cell(test['id'])}）",
            "",
            f"- **実施可否**: {readiness}" + (f"（不足: {'、'.join(missing)}）" if missing else ""),
            f"- 対象機能: {', '.join(sorted(test_fn.get(test['id'], []))) or 'なし'}",
            f"- 対象要件: {', '.join(sorted(test_req.get(test['id'], []))) or 'なし'}",
            "",
            f"1. **事前条件（Given）**: {md_cell(display_value(test.get('preconditions') or ['入力資料に記載なし'], 'preconditions'))}",
            f"2. **操作・入力（When）**: {md_cell(display_steps(test.get('steps', [])))}",
            f"3. **期待結果（Then）**: {md_cell(display_value(test.get('expected_result'), 'expected_result'))}",
            f"- テスト種別: {display_value(test.get('type'), 'type')}／テスト段階: {display_value(test.get('level'), 'level')}",
            f"- 優先度: {display_value(test.get('priority'), 'priority')}／自動化: {display_value(test.get('automation_status', 'unspecified'), 'automation_status')}",
            f"- テストデータ: {md_cell(display_value(test.get('test_data') or ['入力資料に記載なし'], 'test_data'))}",
            f"- 元資料: {', '.join(display_source_ref(ref) for ref in test.get('source_refs', [])) or 'なし'}",
        ])
    lines.extend(["", "## テストに関する要確認事項", ""])
    lines.extend(questions_markdown(relevant_questions, "テストに関する要確認事項はありません。"))
    lines.extend(change_impact_markdown(model))
    return "\n".join(lines) + "\n"


def h(value: Any) -> str:
    return html.escape(str(value), quote=True)


def status_badge(status: str) -> str:
    return f'<span class="status status-{h(status)}">{h(display_value(status, "status"))}</span>'


def preview_lookup(model: dict[str, Any]) -> dict[str, str]:
    """Build short, plain-language previews for linked IDs."""
    previews: dict[str, str] = {}
    for item in model.get("requirements", []):
        previews[item["id"]] = f'{display_value(item.get("kind"), "kind")}: {readable_requirement(item)}'
    for item in model.get("functions", []):
        summary = item.get("summary") or item.get("name") or "内容は入力資料に記載されていません。"
        previews[item["id"]] = f'機能: {item.get("name") or item["id"]}' + (f'\n概要: {summary}' if summary != item.get("name") else "")
    for item in model.get("test_cases", []):
        readiness, missing = test_readiness(item, model)
        previews[item["id"]] = f'テスト: {human_test_title(item)}\n期待結果: {item.get("expected_result") or "入力資料に記載なし"}\n実施可否: {readiness}' + (f'（不足: {"、".join(missing)}）' if missing else "")
    for item in model.get("open_questions", []):
        previews[item["id"]] = f'確認事項: {item.get("question") or "内容は入力資料に記載されていません。"}'
    return {identity: text[:320] + ("…" if len(text) > 320 else "") for identity, text in previews.items()}


def html_id_link(identity: str, previews: dict[str, str]) -> str:
    preview = previews.get(identity, "リンク先で内容を確認できます。")
    return f'<a class="id-link" href="#node-{h(identity)}" data-preview="{h(preview)}">{h(identity)}</a>'


def html_cell(value: Any, previews: dict[str, str] | None = None) -> str:
    previews = previews or {}
    if isinstance(value, dict) and "anchor" in value:
        return f'<span id="node-{h(value["anchor"])}">{h(value.get("text", value["anchor"]))}</span>'
    if isinstance(value, dict) and "html" in value:
        return str(value["html"])
    if isinstance(value, list):
        return ", ".join(html_id_link(str(item), previews) for item in value) or "—"
    return h(value or "—")


def html_table(caption: str, headers: list[str], rows: list[list[Any]], previews: dict[str, str] | None = None) -> str:
    head = "".join(f'<th scope="col">{h(header)}</th>' for header in headers)
    body = "".join("<tr>" + "".join(f"<td>{html_cell(value, previews)}</td>" for value in row) + "</tr>" for row in rows)
    if not rows:
        body = f'<tr><td colspan="{len(headers)}">該当する項目はありません。</td></tr>'
    return f'<div class="table-wrap" role="region" aria-label="{h(caption)}（横にスクロールできます）" tabindex="0"><table><caption>{h(caption)}</caption><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def review_html(model: dict[str, Any]) -> str:
    req_fn, fn_req, fn_test = index_links(model)
    previews = preview_lookup(model)
    test_fn: dict[str, list[str]] = {}
    test_req: dict[str, list[str]] = {}
    for link in model.get("links", []):
        if link.get("type") == "function-to-test":
            test_fn.setdefault(link["to_id"], []).append(link["from_id"])
        elif link.get("type") == "requirement-to-test":
            test_req.setdefault(link["to_id"], []).append(link["from_id"])
    report = model.get("report", {})
    axes = report.get("axes", {})
    open_questions = [item for item in model.get("open_questions", []) if item.get("status", "open") == "open"]
    incomplete_tests = [test for test in model.get("test_cases", []) if test_readiness(test, model)[0] == "要具体化"]
    state = review_state(model)
    error_count = int(state["errors"])
    warning_count = int(state["warnings"])

    def quality_badge(axis: dict[str, Any]) -> str:
        if axis.get("errors"):
            return '<span class="status danger">要対応</span>'
        if axis.get("warnings"):
            return '<span class="status caution">確認推奨</span>'
        return '<span class="status good">問題なし</span>'

    quality_items = "".join(
        f'<li><strong>{h(FIELD_LABELS.get(name, name))}</strong>{quality_badge(axis)}<span>要対応 {len(axis.get("errors", []))}件・確認推奨 {len(axis.get("warnings", []))}件</span></li>'
        for name, axis in sorted(axes.items())
    )
    diagnostics = []
    for name, axis in sorted(axes.items()):
        for severity, messages in (("要対応", axis.get("errors", [])), ("確認推奨", axis.get("warnings", []))):
            for message in messages:
                friendly = friendly_diagnostic(message)
                technical = ""
                if friendly.startswith("自動検査で、利用者向けに未翻訳"):
                    technical = f'<details><summary>担当者向け技術情報</summary><code>{h(message)}</code></details>'
                diagnostics.append(f'<li><strong>{h(severity)}:</strong> {h(friendly)}{technical}</li>')
    question_groups: dict[str, list[dict[str, Any]]] = {}
    for item in open_questions:
        question_groups.setdefault(item.get("return_to", ""), []).append(item)
    action_parts = [
        f'<li><a href="#node-{h(items[0]["id"])}"><strong>{h(question_action(return_to))}</strong></a>（{len(items)}件）<br><span>例: {h(items[0]["id"])} を確認</span></li>'
        for return_to, items in question_groups.items()
    ]
    if error_count or warning_count:
        action_parts.insert(0, f'<li><a href="#diagnostic-details"><strong>自動チェックの内容を確認する</strong></a>（要対応 {error_count}件・確認推奨 {warning_count}件）</li>')
    if incomplete_tests:
        action_parts.append(f'<li><a href="#node-{h(incomplete_tests[0]["id"])}"><strong>テスト条件を具体化する</strong></a>（{len(incomplete_tests)}件）</li>')
    action_items = "".join(action_parts) or "<li>公開前の最終承認を行います。</li>"
    if error_count:
        next_target = "#diagnostic-details"
    elif open_questions:
        next_target = f'#node-{open_questions[0]["id"]}'
    elif incomplete_tests:
        next_target = f'#node-{incomplete_tests[0]["id"]}'
    elif warning_count:
        next_target = "#diagnostic-details"
    else:
        next_target = "#main"
    has_function_candidates = any(function_review_status(model, item.get("id", "")) != "確認済み" for item in model.get("functions", []))
    function_metric_label = "候補を含む機能" if has_function_candidates else "機能"
    dashboard = f'''<section class="dashboard" aria-labelledby="review-state"><div class="state-card {'danger-card' if error_count else 'caution-card' if open_questions or incomplete_tests or warning_count else 'good-card'}"><p class="eyebrow">現在の状態</p><h2 id="review-state">{'要対応事項があります' if error_count else '下書き：確認が残っています' if open_questions or incomplete_tests or warning_count else 'レビュー完了'}</h2><p>未決事項 {len(open_questions)}件／要具体化テスト {len(incomplete_tests)}件／自動チェックの注意 {warning_count}件</p><small class="metric-note">同じ課題を「未決事項」「テストの不足」「自動チェック」の別の観点から数えるため、件数には重なりがあります。</small><a href="{h(next_target)}">次に確認することを見る</a></div><div class="metric-grid"><div><strong>{len(model.get('requirements', []))}</strong><span>要件</span></div><div><strong>{len(model.get('functions', []))}</strong><span>{h(function_metric_label)}</span></div><div><strong>{len(model.get('test_cases', []))}</strong><span>テスト</span></div><div><strong>{len(open_questions)}</strong><span>未決事項</span></div></div></section>'''

    requirement_rows = [[{"anchor": item["id"], "text": f'{item["id"]}（{display_value(item["kind"], "kind")}）'}, {"html": h(readable_requirement(item)).replace("\n", "<br>")}, req_fn.get(item["id"], []), display_value(item["status"], "status"), "、".join(display_source_ref(ref) for ref in item.get("source_refs", []))] for item in ordered_requirements(model)]
    function_rows = [[{"anchor": item["id"]}, item["name"], fn_req.get(item["id"], []), f'{len(fn_test.get(item["id"], []))}件', function_review_status(model, item["id"])] for item in model.get("functions", [])]
    test_rows = []
    for item in model.get("test_cases", []):
        readiness, missing = test_readiness(item, model)
        readiness_html = f'<span class="status {"good" if readiness == "実施可能" else "caution"}">{h(readiness)}</span>'
        if missing:
            readiness_html += f'<small>不足: {h("、".join(missing))}</small>'
        test_rows.append([{"anchor": item["id"]}, human_test_title(item), test_fn.get(item["id"], []), test_req.get(item["id"], []), "、".join(display_steps(item["steps"])), item["expected_result"], {"html": readiness_html}])
    trace_rows = []
    tests_by_id = {test["id"]: test for test in model.get("test_cases", [])}
    functions_by_id = {function["id"]: function for function in model.get("functions", [])}
    for item in ordered_requirements(model):
        if item.get("status") != "current":
            continue
        tests_for_req = sorted(link["to_id"] for link in model.get("links", []) if link.get("type") == "requirement-to-test" and link.get("from_id") == item["id"])
        function_ids = req_fn.get(item["id"], [])
        connected = bool(function_ids) and bool(tests_for_req)
        reviewed = connected and all(function_id in functions_by_id and function_review_status(model, function_id) == "確認済み" for function_id in function_ids)
        ready = connected and all(test_id in tests_by_id and test_readiness(tests_by_id[test_id], model)[0] == "実施可能" for test_id in tests_for_req)
        if not connected:
            trace_label, trace_class = "不足", "danger"
        elif not reviewed or not ready:
            trace_label, trace_class = "要確認", "caution"
        else:
            trace_label, trace_class = "確認可能", "good"
        trace_rows.append([f'{item["id"]}: {item["statement"]}', function_ids, tests_for_req, {"html": f'<span class="status {trace_class}">{trace_label}</span>'}])
    question_rows = [[{"anchor": item["id"]}, item["question"], item.get("affected_ids", []), question_action(item.get("return_to", ""))] for item in open_questions]
    unclassified_rows = [[item.get("title"), display_source_ref(item.get("source_ref", "")), item.get("reason")] for item in model.get("unclassified", [])]

    overview_body = reading_guide_html() + f'<h3>対象機能の概要</h3><p>{h(model.get("context", {}).get("overview") or "概要は入力資料に記載されていません。")}</p><h3>品質確認</h3><ul class="quality-list">{quality_items}</ul><h3>次にすること</h3><ol class="actions">{action_items}</ol>'
    panels = [
        ("overview", "概要", "", overview_body + '<details><summary>入力ファイルの検証情報</summary>' + html_details(model, "sources") + '</details>'),
        ("requirements", "要件", str(len(model.get("requirements", []))), '<p>利用者の目的、必要な振る舞い、例外、達成基準を確認します。関連IDにカーソルを合わせると内容を確認できます。</p>' + html_table("要件一覧", ["ID・種別", "内容", "機能", "対応範囲", "元資料"], requirement_rows, previews) + html_details(model, "requirements")),
        ("functions", "機能", str(len(model.get("functions", []))), '<div class="notice caution-card"><strong>確認してください</strong><p>「候補」と表示された機能は仮の分け方です。重複や不足がないかレビューしてください。関連IDはカーソルを合わせると内容を確認できます。</p></div>' + html_table("機能一覧", ["ID", "機能名", "対応要件", "テスト数", "確認状況"], function_rows, previews) + html_details(model, "functions")),
        ("tests", "テスト", str(len(model.get("test_cases", []))), '<p>何を操作し、どの結果を確認するかを示します。「要具体化」はまだ実施できません。関連IDはカーソルを合わせると内容を確認できます。</p>' + html_table("テスト一覧", ["ID", "確認すること", "機能", "要件", "操作・入力", "期待結果", "実施可否"], test_rows, previews) + html_details(model, "test_cases")),
        ("trace", "つながり", "", '<p>要件がどの機能で実現され、どのテストで確認されるかを見る表です。関連IDはカーソルを合わせると内容を確認できます。</p>' + html_table("要件 → 機能 → テスト", ["要件", "機能", "テスト", "状態"], trace_rows, previews)),
        ("questions", "次に確認", str(len(open_questions)), '<p>上から順に確認すると、公開できる資料へ近づきます。関連IDはカーソルを合わせると内容を確認できます。</p>' + html_table("未決事項", ["ID", "確認すること", "関係するID", "次にすること"], question_rows, previews) + html_table("自動分類できなかった情報", ["資料", "元資料", "理由"], unclassified_rows, previews) + html_details(model, "change_impact")),
    ]
    tabs = "".join(f'<button type="button" role="tab" id="tab-{key}" aria-controls="panel-{key}" aria-selected="{str(i == 0).lower()}" tabindex="{0 if i == 0 else -1}">{h(label)}{f" <span>{h(count)}</span>" if count else ""}</button>' for i, (key, label, count, _) in enumerate(panels))
    content = "".join(f'<section role="tabpanel" tabindex="0" id="panel-{key}" aria-labelledby="tab-{key}"{" hidden" if i else ""}><h2>{h(label)}</h2>{body}</section>' for i, (key, label, _, body) in enumerate(panels))
    raw_diagnostics = '<details id="diagnostic-details" class="diagnostics"><summary>品質診断の詳細</summary><ul>' + (''.join(diagnostics) or '<li>指摘はありません。</li>') + '</ul></details>'
    css = """
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#172033;background:#f3f6fb;line-height:1.7}*{box-sizing:border-box}body{margin:0}.skip{position:absolute;left:-9999px}.skip:focus{left:1rem;top:1rem;background:#fff;padding:.75rem;z-index:10}header{background:linear-gradient(125deg,#12213a,#214b78);color:#fff;padding:1.5rem}header>div,main{max-width:1180px;margin:auto}header h1{margin:0;font-size:clamp(1.45rem,3vw,2.15rem)}header p{margin:.35rem 0 0;color:#dbeafe}.dashboard{max-width:1180px;margin:1.25rem auto;display:grid;grid-template-columns:1.4fr 1fr;gap:1rem}.state-card,.metric-grid>div,.notice{background:#fff;border:1px solid #cad5e5;border-radius:.75rem;padding:1rem}.state-card{border-left:7px solid #b7791f}.state-card h2{margin:.1rem 0}.eyebrow{font-size:.8rem;font-weight:700;letter-spacing:.08em;margin:0;color:#475569}.metric-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.75rem}.metric-grid strong{display:block;font-size:1.75rem}.metric-grid span{color:#475569}.good-card{border-left-color:#238636}.danger-card{border-left-color:#b42318}.caution-card{background:#fff8e7;border-color:#e5b84b}main{padding:0 1rem 2rem}.tabs{position:sticky;top:0;z-index:4;display:flex;gap:.35rem;overflow:auto;background:#f3f6fb;padding-top:.5rem;border-bottom:3px solid #245ea8}.tabs button{white-space:nowrap;border:1px solid #aebdd2;border-bottom:0;border-radius:.45rem .45rem 0 0;background:#e8eef7;padding:.7rem .9rem;cursor:pointer;font-weight:650}.tabs button span{color:#172033;background:#fff;border-radius:1rem;padding:.05rem .4rem;margin-left:.25rem}.tabs button[aria-selected=true]{background:#245ea8;color:#fff}.tabs button:focus-visible,a:focus-visible,summary:focus-visible,[tabindex="0"]:focus-visible{outline:3px solid #f59e0b;outline-offset:2px}[role=tabpanel]{background:#fff;padding:clamp(1rem,3vw,2rem);border:1px solid #d2dbea;border-radius:0 0 .75rem .75rem;min-height:20rem}[role=tabpanel]>p,[role=tabpanel]>aside{max-width:78ch}.table-wrap{overflow:auto;margin:1rem 0;border:1px solid #cbd5e1;border-radius:.5rem}table{border-collapse:collapse;width:100%;min-width:720px}caption{text-align:left;font-size:1.1rem;font-weight:750;padding:.8rem}th,td{border-top:1px solid #d6deea;padding:.7rem;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#eaf0f8}tbody tr:nth-child(even){background:#f8fafc}td:first-child{font-weight:650;white-space:nowrap}.id-link{font-weight:700;text-decoration-style:dotted;text-underline-offset:.18em}.hover-tooltip{position:fixed;z-index:30;max-width:min(30rem,calc(100vw - 1.5rem));padding:.7rem .85rem;border:1px solid #8fa4c0;border-radius:.55rem;background:#172033;color:#fff;box-shadow:0 .5rem 1.5rem #0f172a4d;font-size:.92rem;line-height:1.55;white-space:pre-line;pointer-events:none}.hover-tooltip[hidden]{display:none}.status{display:inline-block;border:1px solid currentColor;border-radius:1rem;padding:.08rem .5rem;font-weight:700;margin:.1rem .4rem .1rem 0}.good{color:#176b3a;background:#eefbf2}.caution{color:#7a4d00;background:#fff4ce}.danger{color:#a1261b;background:#fff0ee}.quality-list{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.6rem}.quality-list li{border:1px solid #d5deeb;border-radius:.5rem;padding:.7rem}.quality-list strong,.quality-list span{display:block}.actions li{margin:.65rem 0}.item-details,.diagnostics,details{margin:.65rem 0;border:1px solid #d6deea;border-radius:.5rem;padding:.45rem .7rem}summary{cursor:pointer;font-weight:700}dl{display:grid;grid-template-columns:minmax(8rem,14rem) 1fr;gap:.35rem 1rem}dt{font-weight:700}dd{margin:0}small{display:block;color:#7a4d00}.notice{margin:1rem 0}@media(max-width:760px){.dashboard{grid-template-columns:1fr}.metric-grid{grid-template-columns:repeat(2,1fr)}.metric-grid strong{font-size:1.25rem}dl{grid-template-columns:1fr}.table-wrap:before{content:"表は横にスクロールできます";display:block;padding:.4rem .7rem;color:#475569;font-size:.85rem}}@media(max-width:430px){.metric-grid{grid-template-columns:1fr}}@media print{body{background:#fff}.tabs,.skip,.hover-tooltip{display:none!important}[role=tabpanel][hidden]{display:block}[role=tabpanel]{break-before:page;border:0}.item-details{break-inside:avoid}details:not([open])>:not(summary){display:block!important}thead{display:table-header-group}tr{break-inside:avoid}.dashboard{display:block}}
""".strip()
    js = """
(()=>{const tabs=[...document.querySelectorAll('[role=tab]')],tip=document.getElementById('id-preview-tooltip');let active=null;function hidePreview(){if(active)active.removeAttribute('aria-describedby');active=null;tip.hidden=true}function placePreview(){if(!active||tip.hidden)return;const r=active.getBoundingClientRect(),gap=8,w=tip.offsetWidth,h=tip.offsetHeight;let left=Math.min(Math.max(12,r.left),innerWidth-w-12),top=r.bottom+gap;if(top+h>innerHeight-12)top=Math.max(12,r.top-h-gap);tip.style.left=`${left}px`;tip.style.top=`${top}px`}function showPreview(link){active=link;tip.textContent=link.dataset.preview;tip.hidden=false;link.setAttribute('aria-describedby',tip.id);placePreview()}function select(tab,focus=true){hidePreview();tabs.forEach(t=>{const on=t===tab;t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).hidden=!on});if(focus)tab.focus()}function reveal(target){const panel=target.closest('[role=tabpanel]');if(panel){const tab=document.getElementById(panel.getAttribute('aria-labelledby'));if(tab)select(tab,false)}target.tabIndex=-1;target.focus();target.scrollIntoView({block:'center'})}tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>select(tab));tab.addEventListener('keydown',e=>{let n;if(e.key==='ArrowRight')n=(i+1)%tabs.length;if(e.key==='ArrowLeft')n=(i-1+tabs.length)%tabs.length;if(e.key==='Home')n=0;if(e.key==='End')n=tabs.length-1;if(n!==undefined){e.preventDefault();select(tabs[n])}if(e.key==='Enter'||e.key===' '){e.preventDefault();select(tab)}})});document.addEventListener('mouseover',e=>{const link=e.target.closest?.('.id-link');if(link&&link!==active)showPreview(link)});document.addEventListener('mouseout',e=>{if(active&&!active.contains(e.relatedTarget))hidePreview()});document.addEventListener('focusin',e=>{const link=e.target.closest?.('.id-link');if(link)showPreview(link)});document.addEventListener('focusout',e=>{if(active&&e.target===active)hidePreview()});document.addEventListener('click',e=>{hidePreview();const link=e.target.closest('a[href^="#node-"]');if(!link)return;const target=document.getElementById(decodeURIComponent(link.hash.slice(1)));if(target){e.preventDefault();history.replaceState(null,'',link.hash);reveal(target)}});addEventListener('scroll',hidePreview,true);addEventListener('resize',hidePreview);if(tabs.length)select(tabs[0],false);if(location.hash.startsWith('#node-')){const target=document.getElementById(decodeURIComponent(location.hash.slice(1)));if(target)reveal(target)}})();
""".strip()
    return f'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{h(display_title(model['title']))} レビュー</title><style>{css}</style></head>
<body><a class="skip" href="#main">本文へ移動</a><header><div><h1>{h(display_title(model['title']))} — 要件・機能・テストレビュー</h1><p>資料の完成度と、次に確認することをまとめています。</p></div></header>{dashboard}<main id="main"><nav class="tabs" role="tablist" aria-label="文書ビュー">{tabs}</nav>{content}{raw_diagnostics}<noscript><style>[role=tabpanel][hidden]{{display:block}}</style><p>JavaScriptが無効なため、すべての内容を続けて表示します。</p></noscript></main><div id="id-preview-tooltip" class="hover-tooltip" role="tooltip" hidden></div><script>{js}</script></body></html>
'''


def rendered_files(model: dict[str, Any], stem: str, feature_dir: Path | None = None) -> dict[str, str]:
    model = copy.deepcopy(model)
    model["report"] = evaluate_model(model, feature_dir, profile=model["profile"])
    if feature_dir is None:
        source_axis = model["report"]["axes"]["source_integrity"]
        source_axis["warnings"].append("source files were not verified during rendering")
        source_axis["metrics"]["warnings"] = len(source_axis["warnings"])
    stem = safe_stem(stem)
    return {
        f"{stem}_要件定義書.md": requirements_markdown(model),
        f"{stem}_機能一覧.md": functions_markdown(model),
        f"{stem}_テスト一覧.md": tests_markdown(model),
        f"{stem}_レビュー.html": review_html(model),
    }


def write_rendered(model: dict[str, Any], output_dir: Path, stem: str, feature_dir: Path | None = None) -> list[Path]:
    require_valid_model(model, feature_dir)
    if model.get("schema_version") != SCHEMA_VERSION:
        raise ValueError(f"unsupported schema_version: {model.get('schema_version')}")
    structural = evaluate_model(model, None, "draft")["axes"]
    structural_errors = structural["source_integrity"]["errors"] + structural["cross_artifact_consistency"]["errors"]
    if structural_errors:
        raise ValueError("invalid canonical model: " + "; ".join(structural_errors))
    output_dir.mkdir(parents=True, exist_ok=True)
    contents = rendered_files(model, stem, feature_dir)
    paths: list[Path] = []
    with tempfile.TemporaryDirectory(prefix="trace-docs-", dir=output_dir.parent) as temporary:
        temporary_dir = Path(temporary)
        staged: list[tuple[Path, Path]] = []
        for name, content in contents.items():
            staged_path = temporary_dir / name
            staged_path.write_text(content, encoding="utf-8", newline="\n")
            staged.append((staged_path, output_dir / name))
        for staged_path, destination in staged:
            os.replace(staged_path, destination)
            paths.append(destination)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser(description="canonical JSONから要件定義書・機能一覧・テスト一覧・レビューHTMLを生成")
    parser.add_argument("canonical_json", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--name", help="出力ファイル名の接頭辞。省略時はJSON名から導出")
    parser.add_argument("--feature-dir", type=Path, help="source fingerprintとlocatorも検査する場合のfeatureディレクトリ")
    args = parser.parse_args()
    try:
        model = json.loads(args.canonical_json.read_text(encoding="utf-8"))
        stem = args.name or args.canonical_json.name.removesuffix("_requirements-functions-tests.json").removesuffix(".json")
        for path in write_rendered(model, args.output_dir, stem, args.feature_dir.resolve() if args.feature_dir else None):
            print(path)
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
