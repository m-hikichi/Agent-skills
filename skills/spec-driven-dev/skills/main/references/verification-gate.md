# 検証ゲート導入ガイド

Agent の文章だけで 100% 一致保証を作るのは難しい。強い保証が欲しいなら、共通の機械ゲートを置く。

## 3 層 + 早期警告で考える

### 早期警告: PostToolUse hook (check_spec_coverage.sh)

コードファイルを変更するたびに、SPEC の契約表に載っているか即座にチェック。載っていなければ警告メッセージを Claude に注入する。block はしないが、Claude が警告を読んで契約表・マトリクスを自動更新する動きを促す。

### Layer 1: `verify_spec_consistency.py`

`requirements.md`、`SPEC-*.md`、`traceability-matrix.md`、実装ファイル、シンボル名、テストIDの対応を機械的に確認する。

強く検出できるもの:

- 仕様IDに対応する実装シンボルが存在しない
- 仕様書に書かれたファイル名、関数名、クラス名が現実と違う
- テストファイルが存在しない
- `TC-XXX` がテストコードから検索できない
- 仕様書、マトリクス、コードの対応関係が崩れている
- **SPEC から参照されない孤立した実装ファイルがある**（`--orphan-check`）

追加機能:
- `--report`: 全 SPEC の進捗一覧（SPEC / Status / FR Total / Implemented / Tested）
- `--format json`: CI 連携用の構造化出力

### Layer 2: `project_test_commands`

プロジェクト固有の自動テストで、仕様書の `実装完了条件` を確認する。

### Layer 3a: `SubagentStop` reviewer（軽量）

サブエージェント完了時に `review_stop_gate.py --skip-audit-check` を走らせる。

- `verify_spec_consistency.py`（`--orphan-check` 有効）のみ実行
- `## 最終整合性監査` セクションは要求しない（orchestrator の責務）
- `project_test_commands` は実行しない（ワークフロー途中で停止しうるため）

### Layer 3b: `Stop` reviewer（完全検証）

メインエージェント（orchestrator）完了時に `review_stop_gate.py` を走らせ、全条件を見て OK / NG を返す。

`判定: clean` の場合:
1. `verify_spec_consistency.py`（`--orphan-check` 有効）が成功
2. `project_test_commands` が成功
3. 最終メッセージの `## 最終整合性監査` が `判定: clean`

`判定: needs-user-decision` の場合:
1. `verify_spec_consistency.py`（`--orphan-check` 有効）が成功（**必須**）
2. `残件:` に内容がある

## 実行モード

`verification.consistency_runner` は `docker` 固定。ローカル環境を汚さないため、整合性検証は必ず Docker コンテナ内で実行する。

## どこまで機械的に強制できるか

- 仕様と実装の接続が崩れていないこと
- 指定したテストコマンドが実際に成功したこと
- SPEC から参照されない孤立コードがないこと
- Claude が最終監査を `clean` または `needs-user-decision` のどちらで閉じようとしているか

## どこから先は人間が必要か

- そのテスト群が十分か
- 仕様自体が正しいプロダクト判断か
- `needs-user-decision` で止めた論点をどう決めるか

機械ゲートは「終わってよい最低条件」を担保する。
