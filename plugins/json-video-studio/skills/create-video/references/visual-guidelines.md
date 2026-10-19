# Visual選択ガイド

## 共通上限

- 1 sceneは1メッセージ。
- 画面タイトルは100文字以下だが、実運用は日本語28文字程度を目安にする。
- 字幕は最大2行。1行24〜32全角文字を目安に、長い発話はsceneを分割する。
- bulletsは最大5件。推奨3件、各項目は1〜2行。
- codeは表示可能な行だけを入れる。全ファイルを貼らない。
- `assetId`は`assets[]`に存在し、期待するtypeと一致させる。

## visualの使い分け

| type | 用途 | 必須項目 | 避けること |
|---|---|---|---|
| `title` | 導入、章扉、1つの結論 | `title` | 長い説明文 |
| `bullets` | 3〜5点の列挙 | `items` | 段落や入れ子 |
| `split` | 2案、Before/Afterの比較 | `left`, `right` | 3列以上の比較 |
| `media` | ローカル画像・動画 | `assetId` | URLやSVG |
| `code` | source、diff、terminal | `variant`, `code` | 小さすぎる全文表示 |
| `quote` | 短い引用・要点 | `quote` | 出典の捏造 |
| `metric` | 数値、棒、折れ線 | `variant`, `label` | 根拠のない数値 |
| `outro` | まとめ、次の行動 | `title` | 新しい論点 |
| `flow` | 入力から結果までの工程を動きで説明 | `steps`, `activeStep` | 無関係な移動、全工程を一度に説明 |

`metric:number`は`value`だけを使う。`metric:bar|line`は`values`を使い、`labels`を指定する場合は同じ要素数にする。

`flow`は2〜4工程。隣接sceneで同じ`steps`を維持し、`activeStep`を0→1→2のように進める。音声は現在の工程の入力・処理・結果を説明する。1秒のデータ移動後に到着先を強調するので、短すぎるsceneを避ける。移動の途中、到着後、scene境界を完成MP4から確認する。登場fadeだけを「動きによる説明」と数えない。

## テンプレート追加境界

JSONから任意React componentを読み込めない。既存8種類と`flow`のテキスト・色・asset・variantで表現する。さらにtypeが必要な場合は、runtimeのSchema・型・renderer・テストを同時に更新する開発作業として扱う。
