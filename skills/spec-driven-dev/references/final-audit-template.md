# 最終整合性監査テンプレート

変更を伴う依頼を本当に閉じる前に、外側の最終メッセージの末尾へ次のブロックを入れる。child skill は authoring summary、implementation summary、audit findings を返すだけに留め、親 `spec-driven-dev` または利用者側の最終 close out でこの書式を組み立てる。

この見出し名と `判定:` の表記は、Claude Code の Stop reviewer が機械的に読む。言い換えない。

```markdown
## 最終整合性監査

- 判定: clean
- 監査対象: `requirements.md`, `SPEC-012`, `src/foo.ts`, `tests/foo.test.ts`
- 実行した検証:
  - `pwsh <installed-skill-dir>/scripts/run_verify_in_docker.ps1 -ProjectRoot .`
  - `docker compose run --rm <service> <your-test-command>`
- 修正した差分:
  - SPEC-012 の入力制約を実装に合わせて更新
  - `src/foo.ts` のエラー条件を仕様どおりに修正
- 残件: なし
```

## `clean` の意味

`clean` は次の 3 条件がそろった状態を指す。

1. `verify_spec_consistency.py` が成功している
2. `project_test_commands` が成功している
3. `High` / `Medium` の不整合が残っていない

## `needs-user-decision` を使うとき

人間の判断待ちで止めるしかない場合だけ使う。

```markdown
## 最終整合性監査

- 判定: needs-user-decision
- 監査対象: `requirements.md`, `SPEC-012`
- 実行した検証:
  - `pwsh <installed-skill-dir>/scripts/run_verify_in_docker.ps1 -ProjectRoot .`
- 修正した差分:
  - SPEC-012 の入力制約を整理
- 残件: モバイルの入力上限を 128 文字と 256 文字のどちらにするか、ユーザー判断が必要
```

これは完了ではなく一時停止の印。reviewer はこの状態なら「人間確認待ち」として止めるが、`clean` と同じ意味にはしない。
