# Claude Code hooks 連携

spec-driven-dev プラグインの完了保証と早期警告の仕組み。

## hook 一覧

| hook | タイミング | 目的 |
|------|-----------|------|
| Stop | メインエージェント完了時 | review_stop_gate.py で整合性チェック + テスト + 最終監査フォーマットを強制 |
| SubagentStop | サブエージェント完了時 | 同上（サブエージェント経由の迂回を防ぐ） |
| PostToolUse (Write\|Edit) | コードファイル変更の都度 | check_spec_coverage.sh で SPEC 未登録ファイルの早期警告 |

## 役割分担

- **PostToolUse hook (check_spec_coverage.sh)**
  - コード変更のたびに、そのファイルが SPEC の実装トレーサビリティ契約に載っているか確認
  - 載っていなければ警告メッセージを Claude のコンテキストに注入（block ではない）
  - .md / .json / 設定ファイルは除外。SPEC 文書(.md)の変更時は verify_spec_consistency.py を軽量実行して契約表の破壊を検出
- **Stop / SubagentStop hook (review_stop_gate.py)**
  - 完了直前に verify_spec_consistency.py（`--orphan-check` 有効）を実行
  - project_test_commands を実行
  - 最終メッセージに `## 最終整合性監査` の `判定: clean` または `判定: needs-user-decision` があるか確認
  - **`needs-user-decision` でも整合性チェックは必ず実行する**（チェックバイパス不可）
  - NG なら block して Claude を作業に戻す
- **親 `main` skill の frontmatter Stop hook**
  - 最終メッセージの書式崩れを減らす補助（prompt 型）

## reviewer が見る条件

### `判定: clean` の場合（3 条件全て必須）
1. `verify_spec_consistency.py`（`--orphan-check` 有効）が成功
2. `verification.project_test_commands` が成功
3. 最終メッセージの `## 最終整合性監査` が `判定: clean`

### `判定: needs-user-decision` の場合
1. `verify_spec_consistency.py`（`--orphan-check` 有効）が成功（**必須、バイパス不可**）
2. `残件:` に人間の判断が必要な内容が書かれている
3. project_test_commands は実行しない（人間判断待ち中のため）

## 実行モード

`spec-config.json` の `verification.consistency_runner` は `docker` 固定。ローカル環境を汚さないため、整合性検証は必ず Docker コンテナ内で実行する。

## block 理由の詳細表示

review_stop_gate.py は block 時に verify_spec_consistency.py の Findings 詳細を理由に含める。「失敗しました」だけでなく、どの SPEC のどの FR で何が問題かが表示される。

## 前提

- `spec-driven-dev` プラグインがインストール済み
- プロジェクトに `docs/requirements.md`、`docs/specs/`、`docs/traceability-matrix.md`、`spec-config.json` がある
- `spec-config.json` の `verification.consistency_runner` が `docker`
- `spec-config.json` の `verification.project_test_commands` が空でない
- ホストに Python 3 がある

## NG のとき何が起きるか

- reviewer が条件を満たしていないと判断すると、NG を返す
- block 理由に具体的な Findings が含まれる
- Claude Code はそのまま止まらず、reason を次の指示として Claude に返す
- Claude は修正を続けるか、`判定: needs-user-decision` でユーザー確認に切り替える

## これで防げること

- `verify_spec_consistency.py` を回さずに完了すること
- プロジェクト固有テストを回さずに完了すること
- `最終整合性監査` を書かずに完了すること
- サブエージェントだけが先に抜けること
- `needs-user-decision` で整合性チェックをバイパスすること
- SPEC に未登録のコードファイルを気づかずに追加すること（PostToolUse 警告）
