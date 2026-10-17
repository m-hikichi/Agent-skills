#!/usr/bin/env python3
"""Compare canonical documents without merging or approving editorial changes."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import sys
from typing import Any

from schema_validation import require_valid_model


LABELS = {
    "statement": "要件の内容", "name": "機能名", "summary": "概要", "title": "名称",
    "basis": "確認・作成根拠", "rationale": "判断理由", "source_refs": "根拠箇所",
    "preconditions": "事前条件", "steps": "操作・入力", "test_data": "テストデータ",
    "expected_result": "期待結果", "business_rules": "業務ルール", "exceptions": "例外",
    "resolution": "解決の判断理由", "status": "状態", "affected_ids": "影響する項目",
    "sha256": "入力ファイルの指紋", "question": "確認事項", "priority": "優先度",
}
MISSING = object()


def cell(value: Any) -> str:
    if value is MISSING:
        return "（項目なし）"
    # JSON preserves arrays, null, empty strings and full nested evidence fields.
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True)
    return html.escape(encoded, quote=False).replace("|", "&#124;").replace("`", "&#96;")


def indexed(items: list[dict[str, Any]], key: str) -> dict[str, dict[str, Any]]:
    result = {item[key]: item for item in items}
    if len(result) != len(items):
        raise ValueError(f"比較できません: {key} が重複しています")
    return result


def fields(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    lines = ["| 項目（正本のキー） | 旧版 | 更新案 |", "|---|---|---|"]
    for key in sorted(set(before) | set(after)):
        left, right = before.get(key, MISSING), after.get(key, MISSING)
        if left != right:
            lines.append(f"| {LABELS.get(key, '詳細項目')}（{cell(key)}） | {cell(left)} | {cell(right)} |")
    return lines


def compare_collection(title: str, old: list[dict[str, Any]], new: list[dict[str, Any]], key: str = "id") -> list[str]:
    before, after = indexed(old, key), indexed(new, key)
    ids = sorted(set(before) | set(after))
    changed = [identifier for identifier in ids if before.get(identifier) != after.get(identifier)]
    lines = [f"## {title}", "", f"旧版 {len(old)}件／更新案 {len(new)}件／差分 {len(changed)}件", ""]
    if not changed:
        return [*lines, "変更はありません。", ""]
    for identifier in changed:
        state = "追加" if identifier not in before else "削除・引継ぎ確認" if identifier not in after else "内容変更"
        lines.extend([f"### {cell(identifier)} — {state}", "", *fields(before.get(identifier, {}), after.get(identifier, {})), ""])
    return lines


def comparison_markdown(old: dict[str, Any], proposed: dict[str, Any]) -> str:
    require_valid_model(old)
    require_valid_model(proposed)
    lines = ["# 文書更新案の比較レビュー", "",
             "この資料は差分の確認用です。自動統合・公開承認は行っていません。旧版・更新案の正本は変更しません。", "",
             "要件・機能・テストはIDで比較します。IDが変わった項目は追加／削除に分かれるため、同じ内容かどうかを担当者が確認してください。",
             "表は変更したキーの値を省略せず示します。引用符・配列は元のJSONの表記です。入力ファイルそのものの存在・内容や根拠の正しさは、この比較では検証しません。", "",
             "## 次に確認すること", "",
             "1. 旧版で直した機能分割・入力データ・期待結果・判断理由が更新案から失われていないか確認する。",
             "2. 関連付けの追加・削除と、解決済み事項の再確認対象を確認する。",
             "3. 入力変更に照らして更新案を修正し、独立レビュー後に描画・公開検査する。", ""]
    for key, title in (("requirements", "要件の変更"), ("functions", "機能の変更"), ("test_cases", "テストの変更")):
        lines.extend(compare_collection(title, old[key], proposed[key]))
    lines.extend(["## 関連付けの変更", "", "| 変更 | 関係 | 元のID | 先のID |", "|---|---|---|---|"])
    old_links = {(item["type"], item["from_id"], item["to_id"]) for item in old["links"]}
    new_links = {(item["type"], item["from_id"], item["to_id"]) for item in proposed["links"]}
    types = {"requirement-to-function": "要件→機能", "requirement-to-test": "要件→テスト", "function-to-test": "機能→テスト"}
    for label, links in (("削除・引継ぎ確認", old_links - new_links), ("追加", new_links - old_links)):
        for kind, left, right in sorted(links):
            lines.append(f"| {label} | {types[kind]} | {cell(left)} | {cell(right)} |")
    if old_links == new_links:
        lines.append("| 変更なし | — | — | — |")
    lines.extend(["", *compare_collection("入力資料・指紋の変更", old["sources"], proposed["sources"], "path")])
    lines.extend(compare_collection("確認事項の変更", old["open_questions"], proposed["open_questions"]))
    lines.extend(["## 旧版の解決済み事項の引継ぎ確認", "", "同じ質問IDでも内容・根拠・判断理由が違えば、同じ判断が引き継がれたとは扱いません。変更のない記録も新しい入力に対する承認を意味しません。", ""])
    new_questions = indexed(proposed["open_questions"], "id")
    resolved = [q for q in old["open_questions"] if q.get("status") == "resolved"]
    for question in resolved:
        other = new_questions.get(question["id"])
        state = "記録一致（新入力での妥当性は別途確認）" if question == other else "そのまま引き継がれていません（再確認が必要）"
        lines.extend([f"- {cell(question['id'])}: {state}。旧判断: {cell(question.get('resolution', MISSING))}／旧根拠: {cell(question.get('source_refs', MISSING))}"])
    if not resolved:
        lines.append("旧版に解決済み事項はありません。")
    return "\n".join([*lines, ""])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old_canonical", type=Path)
    parser.add_argument("proposed_canonical", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.resolve() in {args.old_canonical.resolve(), args.proposed_canonical.resolve()}:
            raise ValueError("出力先に入力JSONは指定できません")
        old = json.loads(args.old_canonical.read_text(encoding="utf-8-sig"))
        proposed = json.loads(args.proposed_canonical.read_text(encoding="utf-8-sig"))
        content = comparison_markdown(old, proposed)
        # Exclusive creation protects existing reports, inputs and symlink targets.
        with args.output.open("x", encoding="utf-8", newline="\n") as output:
            output.write(content)
        print(args.output)
        return 0
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
