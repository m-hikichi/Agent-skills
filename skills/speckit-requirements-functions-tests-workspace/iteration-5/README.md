# 指摘対応と検証記録

確認日: 2026-09-26。対象: `skills/speckit-requirements-functions-tests`。

## 修正した点

- レビュー対象版を内容のSHA-256へ紐づけた。要件・機能・試験・関連・根拠・判断の編集でレビューを失効させ、画面と公開検査の両方を再レビュー待ちにする。
- `review_documents.py digest/record`で、実際に確認した版と担当者・判断を記録する。未解決項目の自動解決や自動承認はしない。
- 引用された実際の表示値「未設定」「TBD」と未記入を区別し、既知の曖昧な定型句も不足と判定する。
- 明示された機能ラベル・同一機能宣言に基づく機能集約と、1要件内の複数GWTから複数試験を生成する。
- 複数行GWT、要件ID付き状態遷移表、ラベル付きRequest/Response契約を試験候補として取り込む。同一シナリオを機能数だけ複製しない。
- コードフェンス内の例を確定試験へ昇格させず、連続する契約のRequest/Responseを取りこぼさない。
- `compare_documents.py`で旧正本と更新案の全変更フィールド・関連・根拠・引き継がれていない判断を比較する。正本は変更しない。
- 独立レビューで見つかった、廃止・将来機能による現行要件のcoverage誤判定を修正した。

## 実行確認

- ユニットテスト: 93件成功。
- 独立レビュー担当作成の動作検証: 33件成功。レビュー後の変更、正常な記録→描画→公開検査、失効後の公開拒否、更新安全性を含む。
- 6種類のfixtureでdraft成功・未レビューpublish拒否: 計12件成功。`matrix/results.json`参照。
- スキル形式検査: 成功。
- `sample/orders_レビュー.html`: 別担当作成の3現行要件・2機能・6試験の架空サンプルをrootが原文と照合し、版付きレビュー記録を追加。公開検査はblocking error 0、未分類の概要を保持する警告1件。実業務承認・試験実施結果ではない。

独立レビューの記録は`independent-review.md`。追加生成処理の最終独立再レビューは担当の利用上限により未完了で、rootがコード・回帰テストを確認して引き継いだ。独立レビューが全変更を網羅したとは扱わない。

## 利用上の境界

機械判定は任意の自然言語の意味やレビュー担当者の真正性を証明しない。OpenAPI/YAML全体の任意形式の自動解釈は未対応であり、根拠を保持してエージェントが補完する。レビュー済み編集と入力変更の競合は比較レビューで解決し、自動マージしない。
公式v1.0.0のCLI・テンプレート限定検証はiteration-4/official-compatの記録を参照。実案件内で公式エージェントコマンドから資料更新までを通した受入検証は未実施である。

## 再実行

```powershell
uv run --offline python -m unittest discover -s skills/speckit-requirements-functions-tests/tests -q
uv run --offline python skills/speckit-requirements-functions-tests-workspace/iteration-5/independent_probes.py
uv run --offline python skills/speckit-requirements-functions-tests-workspace/iteration-4/verify_matrix.py --output-dir skills/speckit-requirements-functions-tests-workspace/iteration-5/matrix
```

Windowsで文字コードが異なる環境では`$env:PYTHONUTF8 = '1'`を設定する。初回生成の検証には新しい出力ディレクトリを使う。
