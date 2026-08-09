# Visual templateガイド

v0.1では固定された8種類だけを使います。これによりJSONを安全に保ち、全sceneをgolden testとstoryboardレビューの対象にできます。

全8種類を無音sceneで確認するSchema fixtureは[`../examples/all-templates.video-project.json`](../examples/all-templates.video-project.json)です。`media`だけはdata URIやremote URLを使わず、安全な相対pathのplaceholderを参照します。resolve前に実在するローカル画像へ差し替えてください。

## 例

### 比較

```json
{
  "type": "split",
  "leftTitle": "Before",
  "left": "工程ごとに手作業",
  "rightTitle": "After",
  "right": "JSONを修正して再レンダー"
}
```

### terminal

```json
{
  "type": "code",
  "variant": "terminal",
  "title": "検証",
  "language": "text",
  "code": "$ json-video validate video-project.json\nValidation passed"
}
```

### 数値

```json
{
  "type": "metric",
  "variant": "number",
  "label": "対応fps",
  "value": "30"
}
```

### 折れ線

```json
{
  "type": "metric",
  "variant": "line",
  "label": "月別視聴数",
  "values": [120, 180, 260],
  "labels": ["4月", "5月", "6月"]
}
```

## 新しい見た目が必要な場合

JSONへJSXやcomponent pathを追加してはいけません。まず既存typeのvariant、theme、ローカル画像で表現します。新しいtypeが本当に必要なら、別のruntime変更としてSchema、TypeScript union、Remotion component、Web UI form、golden frame、ドキュメントを同時に追加します。
