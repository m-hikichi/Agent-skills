---
name: spec-audit
description: requirements / specs / matrix / code / tests の整合性を監査し、Findings を重大度と修正分類つきで返す監査担当 skill。仕様と実装のズレ確認、変更後の監査、差分整理が必要なときに使う。機械検証は Claude が自動実行し、人間に手動チェックを要求しない。次工程の制御や最終停止判定はこの skill が担わない。
---

# Spec Audit

この skill は「見る役」である。requirements / specs / matrix / code / tests の整合性を監査し、Findings を重大度と修正分類つきで返す。**機械検証は Claude が自動で実行し、人間に手動チェックを要求しない。** 修正そのもの、次にどの skill を呼ぶかの判断、`## 最終整合性監査` による最終 close out はここに持ち込まない。

## この skill が担当すること

- requirements / specs / matrix / code / tests の整合性監査
- `verify_spec_consistency.py` の自動実行と結果に基づく Findings の返却
- テスト仕様の種別充足確認（各 FR/NFR に正常系・異常系・境界値があるか）
- 差分の重大度整理
- 差分の修正分類整理

## この skill が抱え込まないこと

- コード、仕様、要件、テスト、マトリクスの修正そのもの
- 次にどの skill を呼ぶかの判断
- reviewer による終了ブロックの制御
- `## 最終整合性監査` の最終 close out

## 参照ファイル

- [references/consistency-checklist.md](references/consistency-checklist.md): 監査観点と findings 整理のチェックリスト

## 監査で見る観点

- `requirements.md` と `SPEC-XXX` の対応が崩れていないか
- `SPEC-XXX` の `対応要件`、`実装トレーサビリティ契約`、`実装完了条件`、`テスト仕様` が互いに一致しているか
- トレーサビリティマトリクスが `要件ID -> 仕様ID -> 機能ID -> 実装シンボル -> テストID` の粒度で埋まっているか
- コードとテストが仕様の契約どおりか
- `verify_spec_consistency.py` と `verification.project_test_commands` の結果に差分が残っていないか
- **各 FR/NFR のテスト仕様に正常系・異常系・境界値の 3 種別が揃っているか**
- **SPEC から参照されない孤立した実装ファイルがないか**（`--orphan-check`）

## Findings の分類

- `implementation-fix`: コード / テスト / マトリクス側の修正で解消すべき差分
- `spec-fix`: requirements / specs / matrix の記述修正で解消すべき差分
- `needs-user-decision`: product decision や外部仕様が未確定で、その場で機械的に閉じられない差分

分類は「どこを直すべきか」が最も分かるものを 1 つ選ぶ。迷う場合や、判断材料そのものが不足している場合は `needs-user-decision` に寄せる。

## 手順

1. `spec-config.json` を読み、`requirements_path`、`spec_dir`、`traceability_path`、`verification.consistency_runner`、`verification.project_test_commands` を確認する。
2. [consistency-checklist.md](references/consistency-checklist.md) を使って、監査対象の requirements / specs / matrix / code / tests を確定する。
3. **`verify_spec_consistency.py` を実行する**（`--orphan-check` 有効）。Claude が自動で実行し、出力を監査根拠に含める。
4. 必要なら `verification.project_test_commands` を再実行して監査根拠を取り直す。
5. テスト仕様セクションを確認し、各 FR/NFR に正常系・異常系・境界値の 3 種別があるか確認する。不足があれば Finding に含める。
6. 差分ごとに、重大度を `High` / `Medium` / `Low` で付け、分類を `implementation-fix` / `spec-fix` / `needs-user-decision` で付ける。
7. 根拠、影響、必要な更新内容を短くまとめて返す。

## audit 専用 close out

この skill の最後は、監査結果を Findings と監査サマリーで返す。`## 最終整合性監査` は必須にしない。

```markdown
## Findings

1. High / implementation-fix: SPEC-012 / FR-001 の matrix 行が `実装トレーサビリティ契約` と一致しない
   - 根拠: matrix は `src/foo.ts` を指しているが、仕様は `src/bar.ts` を指している
   - 影響: 仕様から実装を追跡できない
   - 必要な更新: matrix または契約表のどちらが正しいか揃える

2. Medium / spec-fix: SPEC-012 / FR-002 のテスト仕様に境界値テストが定義されていない
   - 根拠: テスト仕様セクションに正常系と異常系のみ
   - 影響: 境界条件のバグを見逃すリスク
   - 必要な更新: テスト仕様に境界値テストケースを追加

## Audit Summary

- 監査対象: `requirements.md`, `SPEC-012`, `src/foo.ts`, `tests/foo.test.ts`
- 確認した検証: `verify_spec_consistency.py` (orphan-check 有効), `verification.project_test_commands`
- 監査結果: findings-present
```

差分がない場合は `## Findings` に `なし` と書き、`## Audit Summary` の `監査結果:` を `clean` にする。`needs-user-decision` は Findings の分類として使い、誰の判断が必要かを明示する。
