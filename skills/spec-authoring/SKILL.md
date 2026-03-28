---
name: spec-authoring
description: `requirements.md` と `SPEC-XXX` を新規作成 / 更新し、`FC-` / `NF-` と `FR-` / `NFR-` の接続、`実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様`、トレーサビリティマトリクス初期行まで整える authoring 専用 skill。コード実装前に、仕様と要件を文章としてそろえたいときに使う。
---

# Spec Authoring

この skill は「書く役」である。`requirements.md`、`SPEC-XXX`、トレーサビリティ接続を整え、authoring として必要な成果物をそろえる。コード実装、最終整合性監査、次工程の制御はここに持ち込まない。

## この skill が担当すること

- `requirements.md` の新規作成 / 更新
- `SPEC-XXX` の新規作成 / 更新
- `FC-` / `NF-` と `FR-` / `NFR-` の接続整理
- `実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様` の明文化
- トレーサビリティマトリクスの初期行追加または更新

## この skill が抱え込まないこと

- approved 前提のコード実装
- 最終整合性監査を完了条件にすること
- reviewer による終了ブロックの制御
- 次に何を進めるかの判断

共通 hooks / settings reviewer は別レイヤーの責務として残す。この skill 自体は authoring の成果物を返せばよい。

## 参照ファイル

- [references/requirements-template.md](references/requirements-template.md): `requirements.md` のテンプレートと運用メモ
- [references/spec-template.md](references/spec-template.md): `SPEC-XXX` のテンプレートと必須セクション
- [references/traceability-matrix-template.md](references/traceability-matrix-template.md): マトリクス初期行のテンプレートと更新粒度

SKILL.md だけで大枠を理解し、細かい書式が必要なときだけ自分の `references/` を開く。

## 事前確認

1. `spec-config.json` を読み、`requirements_path`、`spec_dir`、`traceability_path` を確認する。
2. 既存の `requirements.md`、対象 `SPEC-XXX`、関連仕様、トレーサビリティマトリクスを読み、今回触る機能境界を決める。
3. 既存IDを振り直さずに済むか、どの `FC-` / `NF-` / `FR-` / `NFR-` を追加または更新するかを確認する。

## authoring ルール

### `requirements.md`

- WHAT を書く。HOW やコード詳細は書き込みすぎない。
- `FC-LL-MM-NNN` と `NF-NNN` を安定 ID として扱う。
- 少なくとも `プロダクトゴール`、`対象ユーザー`、`MVPスコープ`、`MVP対象外`、`受け入れ基準`、`要件と仕様の対応（Traceability）` を持たせる。

### `SPEC-XXX`

- frontmatter に `spec_id`、タイトル、`status`、日付、作者、`related_specs` を入れる。
- 本文では少なくとも `対応要件（requirements.md）`、`機能仕様（要件実装一覧）`、`実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様` をそろえる。
- `実装トレーサビリティ契約` では、`機能ID` ごとに実装ファイル、シンボル種別、シンボル名、テストファイル、テストIDを表で固定する。
- `実装完了条件` では、各 `FR-` / `NFR-` に対して観測可能な結果を書く。
- `テスト仕様` では、少なくとも正常系、異常系、境界値、権限 / 状態遷移の観点を漏らさない。

### トレーサビリティマトリクス

- `requirements.md` と `SPEC-XXX` に書いた接続と同じ粒度で初期行を置く。
- 実装前の行は `❌` または `🔧` など、未実装であることが分かる状態にする。
- 同じ `FR-` / `NFR-` が複数シンボルまたは複数要件にまたがるなら、行を分ける。
- `要件ID -> 仕様ID -> 機能ID(FR/NFR) -> 実装シンボル -> テストID` を追える形にする。

### open questions

- 外部仕様や product decision が未確定なら、本文に混ぜず open questions として分離する。
- 未確定事項を埋めたふりで閉じない。

## 手順

1. 要件に変更が及ぶなら、[requirements-template.md](references/requirements-template.md) を参照して `requirements.md` の対象節を更新し、`要件と仕様の対応（Traceability）` をそろえる。
2. [spec-template.md](references/spec-template.md) を参照して `SPEC-XXX` を新規作成または更新し、`対応要件`、`機能仕様`、`実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様` を埋める。
3. 実装前でも、予定している実装ファイル、シンボル名、テストIDを `実装トレーサビリティ契約` に置く。
4. [traceability-matrix-template.md](references/traceability-matrix-template.md) を参照して、トレーサビリティマトリクスに対象要件と対象仕様の初期行を追加または更新する。
5. 未確定事項があれば open questions として分離し、本文の確定事項と混ぜない。

## done 条件

- `requirements.md` の更新有無が明確になっている
- `SPEC-XXX` に `対応要件`、`実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様` がある
- `FC-` / `NF-` と `FR-` / `NFR-` の対応が追える
- マトリクス初期行が追加または更新されている
- 未確定事項は本文に混ぜず open questions として分離されている

## authoring 専用 close out

この skill の最後は、authoring として何をそろえたかを短く返す。`最終整合性監査` は必須にしない。

```markdown
## Authoring Summary

- `requirements.md`: 更新あり / なし
- 更新した仕様: `SPEC-012`, `SPEC-013`
- 追加 / 更新した要件ID: `FC-01-01-001`, `NF-003`
- 追加 / 更新した機能ID: `FR-001`, `FR-002`, `NFR-001`
- 更新したマトリクス行: `FC-01-01-001 -> SPEC-012 -> FR-001`
- 未確定事項: なし
```

未確定事項がある場合は、`未確定事項:` に短く列挙する。authoring として何が揃い、どこが未確定かが分かればよい。
