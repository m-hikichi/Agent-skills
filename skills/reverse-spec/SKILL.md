---
name: reverse-spec
description: 既存コードから、今回触る範囲に必要な最低限の `requirements.md` / `SPEC-XXX` / トレーサビリティを逆生成する bootstrap skill。仕様資産がない既存機能を spec-driven-dev family に入れる前の準備として使う。
---

# Reverse Spec

この skill は、仕様が無い既存機能に対して「最低限の仕様を起こす役」である。全面的なドキュメント化ではなく、今回の変更判断と追跡に必要な粒度までを逆生成する。`spec-driven-dev` family そのものではなく、family に入る前の bootstrap として使う。

## この skill が担当すること

- 既存コード、テスト、README、API定義、画面仕様から観測可能な振る舞いを抽出する
- `requirements.md` の最小版を起こす
- `SPEC-XXX` とトレーサビリティマトリクスを最小限作る
- 推測と事実を分け、未確定事項を open questions として残す

## この skill が抱え込まないこと

- 仕様影響判定
- approved な仕様からのコード実装
- 最終整合性監査の close out
- 次にどの skill を使うかの判断
- reviewer による終了ブロックの制御

## 参照ファイル

- [references/reverse-spec-playbook.md](references/reverse-spec-playbook.md): 既存コードから仕様を起こすときの観点と注意点

## 手順

1. 変更対象のエントリポイントと、今回触るファイル範囲を確定する。
2. 実装コード、既存テスト、README、設計メモ、API スキーマ、画面遷移から、ユーザーから観測できる振る舞いを列挙する。
3. [references/reverse-spec-playbook.md](references/reverse-spec-playbook.md) に従って、`requirements.md` の最小版を作る。
4. 振る舞いを機能単位にまとめ、必要な数だけ `SPEC-XXX` を作る。観測できた事実だけを `FR-` / `NFR-` に落とす。
5. `実装トレーサビリティ契約` と `実装完了条件` は、観測できた実装ファイル、シンボル名、テストIDだけで埋める。
6. トレーサビリティマトリクスを作り、今回触るファイルを requirements / specs / tests と結ぶ。
7. 推測が混ざる箇所は open questions に分離し、決め打ちしない。

## done 条件

- 今回の変更判断に必要な範囲だけが仕様化されている
- `requirements.md`、`SPEC-XXX`、マトリクスの接続が最小限追える
- 推測と観測事実が分離されている
- 未確定事項が open questions として分離されている

## reverse-spec 専用 close out

この skill の最後は、逆生成した成果物と未確定事項を短く返す。`## 最終整合性監査` は必須にしない。

```markdown
## Reverse Spec Summary

- 起こした要件: `docs/requirements.md`
- 起こした仕様: `SPEC-010`, `SPEC-011`
- 起こしたマトリクス行: `FC-01-01-001 -> SPEC-010 -> FR-001`
- 未確定事項: なし
```

未確定事項がある場合は、推測で埋めず `未確定事項:` に短く列挙する。bootstrap として何が起き、何がまだ曖昧かが分かればよい。
