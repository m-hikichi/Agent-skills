---
name: main
description: 仕様/スペック/要件/SPEC-/FR-/トレーサビリティ周りの総合窓口。依頼の入口が曖昧なときに、仕様影響判定、仕様作成、実装、整合性監査のどこから始めるべきかを振り分け、必要なら `spec-authoring` / `spec-implementation` / `spec-audit` を往復させる。全ての記載は Claude が自動で行い、人間はレビュー・承認・意思決定のみ。迷ったらこの skill を使う。目的が明確なら core child skill を直接使ってよい。Claude Code の完了ブロックはプラグインの hooks/hooks.json と scripts/ 配下の reviewer が担う。
hooks:
  Stop:
    - hooks:
        - type: prompt
          prompt: |
            You are the report-format reviewer for spec-driven-dev.
            Inspect the Stop hook input JSON in $ARGUMENTS.
            Look only at last_assistant_message.
            Return {"ok": true} only when the message contains a section titled "最終整合性監査" and that section includes a line "判定: clean" or "判定: needs-user-decision".
            Return {"ok": false, "reason": "..."} otherwise.
---

# Spec-Driven Development Router

この skill は、仕様系作業の「総合窓口」として振る舞うルーター兼オーケストレーターである。依頼内容を見て適切な子 skill へ振り分け、必要なら child skill 間の往復を管理する薄い入口として使う。

**全ての記載（仕様書、マトリクス、コード、テスト）は Claude が自動で行う。人間に手動の記載作業を要求しない。人間の役割はレビュー・承認・意思決定のみ。**

child skill には狭い責務だけを持たせる。次工程の判断、差分修正ループの制御、最終 close out の組み立ては親で扱い、共通の hooks / reviewer / verification scripts はプラグインルートの `hooks/` と `scripts/` に置く。child 固有のテンプレートは各子 skill の `references/` に置く。

## 役割

- 依頼の入口を見て、どの子 skill から始めるべきかを決める
- 必要なら `spec-authoring` / `spec-implementation` / `spec-audit` の往復を管理する
- `High` / `Medium` の不整合が残る限り、どこへ戻すべきかを判断する
- 完了ブロックの強制力はプラグインの `hooks/hooks.json` と `scripts/review_stop_gate.py` にあると明示する

## core child skill 一覧

| skill | 担当する仕事 | 使う場面 |
|---|---|---|
| [spec-impact-analysis](../spec-impact-analysis/SKILL.md) | 変更が仕様影響あり / なしを判定する。「既存仕様なし」なら自動 bootstrap | バグ修正、改善、リファクタリング、rename / move 前 |
| [spec-authoring](../spec-authoring/SKILL.md) | `requirements.md` と `SPEC-XXX` とマトリクス初期行を自動作成 / 更新 | 要件整理、仕様作成、仕様更新、仕様分割 |
| [spec-implementation](../spec-implementation/SKILL.md) | approved な仕様からコード / テスト / マトリクスを自動実装し、途中検証まで回す | 「この SPEC を実装して」「仕様から進めて」 |
| [spec-audit](../spec-audit/SKILL.md) | 整合性を自動監査し、Findings を返す（orphan-check・種別充足確認含む） | 「仕様とコードが合っているか確認して」「差分を整理して」 |

## family 外の bootstrap skill

| skill | 担当する仕事 | 使う場面 |
|---|---|---|
| [reverse-spec](../reverse-spec/SKILL.md) | 既存コードから最低限の仕様を自動逆生成する | 仕様資産が無い既存機能を core family に入れる前 |

## 依頼からワークフローを選ぶ

| 依頼の種類 | 最初に使う skill | その後の典型フロー |
|---|---|---|
| バグ修正、改善、リファクタリング | `spec-impact-analysis` | 影響ありなら `spec-authoring` -> `spec-implementation` -> `spec-audit` を親が往復管理 |
| 新規機能の相談、要件整理 | `spec-authoring` | `spec-authoring` -> `spec-implementation` -> `spec-audit` を親が往復管理 |
| 仕様書の新規作成 / 更新 | `spec-authoring` | docs をそろえ、必要なら親が `spec-audit` まで回す |
| approved な仕様の実装 | `spec-implementation` | 実装後に `spec-audit` し、Findings に応じて親が戻し先を決める |
| 整合性確認、最終チェック | `spec-audit` | Findings を返し、必要なら親が修正ループを管理する |
| 仕様資産が無い既存コードの改修 | `spec-impact-analysis` | 「既存仕様なし」判定で自動 bootstrap → `spec-authoring` or `spec-implementation` へ |

## 実装系依頼のオーケストレーション

1. 依頼が「判定」「書く」「作る」「見る」のどれかを見極める。
2. 仕様資産そのものが無い場合は、`spec-impact-analysis` が自動 bootstrap する。手動での仕様作成は要求しない。
3. 変更影響が不明なら `spec-impact-analysis` を先に使う。
4. 仕様が不足している、または更新が必要なら `spec-authoring` を使う。
5. approved またはユーザー確認済み仕様がそろったら `spec-implementation` を使う。
6. 実装結果を `spec-audit` で監査する。
7. Findings が `implementation-fix` なら `spec-implementation` に戻す。
8. Findings が `spec-fix` なら `spec-authoring` に戻す。
9. Findings が `needs-user-decision` なら、人間判断待ちとして一時停止する。これは完了ではない。
10. `High` / `Medium` の不整合がなくなるまで 5 から 9 を繰り返す。
11. 最後に `## 最終整合性監査` を [references/final-audit-template.md](references/final-audit-template.md) に沿って整え、停止可否はプラグインの `Stop / SubagentStop` reviewer に判定させる。

child skill 自身はこの往復ロジックを持たない。次工程の判断は常に親 skill または利用者が行う。

## 変えない前提

完了保証の考え方は同じである。

- `verify_spec_consistency.py`（`--orphan-check` 有効）
- `verification.project_test_commands`
- `## 最終整合性監査` の `判定: clean`

この 3 条件を reviewer が再確認して初めて、Claude Code の完了ブロックが成立する。`判定: needs-user-decision` は完了ではなく、人間判断待ちの一時停止である。**ただし `needs-user-decision` でも整合性チェック（`verify_spec_consistency.py`）は必ず通す。チェックが通らなければ停止は許可されない。**

強制力の本体はプラグインの `scripts/review_stop_gate.py` と `hooks/hooks.json` の `Stop / SubagentStop` hook にある。

## 共通基盤

- hooks 設定: [references/claude-code-hooks.md](references/claude-code-hooks.md)
- 完了保証の考え方: [references/verification-gate.md](references/verification-gate.md)
- 最終監査の書式: [references/final-audit-template.md](references/final-audit-template.md)
