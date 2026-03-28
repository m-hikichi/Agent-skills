---
name: spec-implementation
description: approved またはユーザー確認済み仕様からコード、テスト、トレーサビリティマトリクスを実装し、機械検証まで回す実装担当 skill。`SPEC-XXX` が実装可能な粒度で固まっているときに使う。次工程の制御や最終 close out はこの skill が担わない。
---

# Spec Implementation

この skill は「作る役」である。approved またはユーザー確認済み仕様からコード、テスト、トレーサビリティマトリクスを実装し、機械検証まで回す。次に何を進めるかの判断、最終整合性監査の close out、reviewer による停止制御はここに持ち込まない。

## この skill が担当すること

- approved またはユーザー確認済み仕様の実装
- 仕様に紐づくテストコードの作成 / 更新
- トレーサビリティマトリクスの更新
- `run_verify_in_docker.*` または `verify_spec_consistency.py` 相当の整合性検証
- `verification.project_test_commands` の実行
- 機械検証で見つかった、自分の担当範囲で直せる差分の修正と再実行

## この skill が抱え込まないこと

- 要件や仕様の新規設計そのもの
- 最終整合性監査の書式で依頼を閉じること
- reviewer による終了ブロックの制御
- 次にどの skill を呼ぶかの判断

## 着手条件

- 対象 `SPEC-XXX` が `approved`、またはユーザーが実装してよいと明示している
- `対応要件（requirements.md）` がある
- `実装トレーサビリティ契約` がある
- `実装完了条件` がある

この前提が欠けている場合は、仕様不足として未解決事項に明示し、実装側で埋めたふりをしない。

## 事前確認

1. `spec-config.json` を読み、`requirements_path`、`spec_dir`、`traceability_path`、`verification.consistency_runner`、`verification.project_test_commands` を確認する。
2. 対象 `SPEC-XXX` と依存仕様を読み、今回実装する `FR-` / `NFR-`、実装ファイル、シンボル、テストIDを確定する。
3. `実装トレーサビリティ契約` とマトリクス初期行を見て、今回変更するコード / テスト / matrix の範囲を確定する。

## 手順

1. 対象仕様と依存仕様を読み、今回実装する `FR-` / `NFR-` だけを確定する。
2. `実装トレーサビリティ契約` と `実装完了条件` を基準に、実装ファイル、シンボル名、テストファイル、テストIDを外さないようにコードを書く。
3. `テスト仕様` に従ってテストコードを作成 / 更新し、テストコード側にも `TC-XXX` を検索できる文字列を残す。
4. 実装したファイル、主要シンボル、テストファイル、テストIDをマトリクスへ反映する。
5. `verification.consistency_runner` が `docker` なら `run_verify_in_docker.*` 相当で整合性検証を実行し、それ以外なら環境制約の範囲で `verify_spec_consistency.py` を実行する。
6. `verification.project_test_commands` を順に実行する。
7. 機械検証で見つかった差分のうち、自分の担当範囲で解消できるものは修正して 5 と 6 をやり直す。
8. 仕様不足、外部仕様依存、または自分の担当範囲を超える差分だけを未解決事項として残す。

## done 条件

- 更新したコード、テスト、マトリクスが明確になっている
- `verify_spec_consistency.py` 相当の整合性検証を実行している
- `verification.project_test_commands` を実行している
- 自分の担当範囲で直せる機械検証差分は解消し、必要なら再実行している
- 解消できない差分や仕様起因の差分は、未解決事項として分離されている

## implementation 専用 close out

この skill の最後は、実装担当として何を更新し、どの機械検証を回し、何が残っているかを短く返す。`## 最終整合性監査` は必須にしない。

```markdown
## Implementation Summary

- 更新したコード: `src/foo.ts`, `src/bar.ts`
- 更新したテスト: `tests/foo.test.ts`
- 更新したマトリクス行: `FC-01-01-001 -> SPEC-012 -> FR-001`
- 実行した機械検証:
  - `run_verify_in_docker`
  - `verification.project_test_commands`
- 機械検証で残った差分: なし
- 未解決事項: なし
```

差分が残る場合は、`機械検証で残った差分:` と `未解決事項:` に分けて書く。親 skill または利用者が次工程を判断できるだけの材料を返せばよい。
