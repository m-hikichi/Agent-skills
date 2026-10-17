# Spec Kit v1.0 文書サンプル

初心者向け表示を確認できる、再生成可能な一式です。`spec.md`が入力、`canonical.json`が派生成果物の正本です。
ほかの4ファイルは正本から生成した閲覧用資料で、直接編集しません。

- `requirements.md`: 要件定義書
- `functions.md`: 要件に紐づく機能一覧
- `tests.md`: 機能・要件に紐づくテスト仕様書
- `review.html`: 全体の状態と資料間のつながりを確認する画面

このサンプルは未決事項を含むレビュー用の下書きです。「候補」「要具体化」は不具合ではなく、入力仕様で
確認・追記が必要な箇所を示します。

## 再生成と検査

リポジトリのルートで次を実行します。生成時の正規ファイル名は、日本語名を含む5ファイルです。

```powershell
python skills/speckit-requirements-functions-tests/scripts/generate_documents.py `
  samples/speckit-v1/spec.md --output-dir samples/speckit-v1/generated `
  --mode spec-only --profile draft --name sample

python skills/speckit-requirements-functions-tests/scripts/check_documents.py `
  samples/speckit-v1/spec.md `
  samples/speckit-v1/generated/sample_requirements-functions-tests.json `
  --output-dir samples/speckit-v1/generated --profile draft --name sample
```
