# 独立レビュー記録（iteration-5）

担当: independent_review。実施日: 2026-09-26。

## 確認範囲

SKILL.md と references/format_spec.md を全文確認し、review_integrity.py、review_documents.py、update_safety.py、生成・投影・公開チェックの接続をレビューした。ソースコードは変更していない。独自検証は independent_probes.py に保存し、一時ディレクトリ内のコピーだけを変更した。

現時点の独立検証: **33 件成功 / 33 件**。

- レビュー後の期待結果・リンク・入力指紋・質問の解決理由・機能説明の変更はレビューを失効させる。
- report/profile/generation_digest の更新は内容レビューを失効させない。
- 同じ入力の再生成は手動編集テスト・関連・レビュー記録を保持する。
- 入力変更とレビュー済み正本が重なる場合は上書きを停止する。更新案には承認を引き継がず、比較レビューが必要となる。
- 古い digest を使う record CLI は終了コード 2 で拒否し、正本のバイト列を変更しない。
- 正常な digest → record → render → publish の CLI 一連はすべて終了コード 0。
- レビュー後に期待結果を変更し再投影しても、publish は終了コード 1 で停止する。画面上の項目状態も「内容レビュー待ち」となる。
- 引用された表示文字列「未設定」や入力値 "TBD" は文脈がある場合に受理する。一方で「適切なデータ」「正しく動作する」「準備済み」、単独 TODO は未具体化と判定する。
- 3 現行要件・2 機能・6 試験の架空 many-to-many サンプルは有効なレビュー記録を付けた場合に公開検査を通る。

再実行:

```powershell
$env:UV_CACHE_DIR = Join-Path (Get-Location) '.uv-cache'
uv run --offline python skills/speckit-requirements-functions-tests-workspace/iteration-5/independent_probes.py
```

## 発見して修正確認した問題

**高: 現行要件の coverage に廃止・将来機能を数えていた。**

再現は架空サンプルの FNC-001.status を retired または future に変更し、診断用に新しいレビュー指紋を付けて evaluate_model(..., 'publish') を実行するだけ。FR-001 が現行機能を持たないにもかかわらず publishable / blocking_errors=0 だった。SKILL.md の「将来・対象外・廃止要素を現行要素としてcoverageへ数えない」と不一致。

親エージェントが現行機能・現行規範要件の条件を追加した後、独立検証の両ケースが拒否されることを確認した。修正済み。

## 残る範囲・制約

上記の限定範囲に未解決の高・中優先度指摘はない。これは任意の仕様に対する意味的完全性、実業務承認、実装されたシステムの試験合格を保証しない。レビュー指紋は変更検知であり、電子署名や担当者の真正性の証明ではない。自然言語の具体性検査も有限の語句検査であり、独立内容レビューを代替しない。

追加予定の richer derivation と最終版ドキュメントの再確認は、変更が揃った後にこの記録へ追記する。
