# Hybrid asset pipeline

すべての視覚素材を再現可能・監査可能にする。素材は `slides/assets/`、由来は `asset-manifest.json` に残す。

## 優先順位

1. ユーザー提供のロゴ、写真、画面キャプチャ
2. 元データから生成するチャート、表、構造図
3. URL、作者、ライセンスを確認し、workspaceへ取得したWeb素材
4. 背景、概念イラスト、雰囲気表現に限るAI生成画像

前段で不足を隠すために、後段の生成画像を使わない。実在人物・製品・画面を表すときはユーザー素材または検証可能な素材を優先する。

## `image_policy` の解釈

- `hybrid`: 上記の優先順位をすべて利用できる既定値
- `provided-only`: ユーザー提供素材と、その提供データから決定的に生成するchart／diagramだけを使う
- `local-only`: workspace内の既存素材と決定的な派生物だけを使い、Web取得とAI画像生成を行わない
- `generated-concepts`: 概念visualが必要な場合だけAI生成を許可し、事実・人物・製品・画面の代用品にはしない

方針が素材不足と衝突したら、別方針へ黙って切り替えず`needs_user`にする。

## Data chart

1. CSV/JSONを原本として保存する。
2. 聞き手に比較させる対象と結論を1文で定義する。
3. Vega-Lite specを保存し、`marp_render_chart`で静的SVGへレンダーする。
4. 軸、単位、期間、母数、欠損処理、出典を表示する。
5. 強調系列以外を抑え、結論注釈を図の近くへ置く。
6. spec、入力データ、SVGのhashをmanifestへ記録する。

```text
marp_render_chart({
  spec: "slides/assets/volume.vl.json",
  data: "slides/assets/volume.csv",
  output: "slides/assets/volume.svg"
})
```

CSSの`width: 54%`やUnicode文字でデータバーを描かない。異なる単位を同じ長さで比較しない。0を省略する軸や対数軸は理由を明示する。

## Diagram

Mermaid sourceを保存し、`marp_render_diagram`で静的SVGへ変換する。ノード名、境界、矢印の意味、方向を明示する。複雑な図は一枚に詰めず、overviewとfocusへ分ける。runtime Mermaid/Vegaや外部JavaScriptへ依存しない。

```text
marp_render_diagram({
  source: "slides/assets/architecture.mmd",
  output: "slides/assets/architecture.svg",
  theme: "neutral",
  background: "transparent"
})
```

## Photo / screenshot / illustration

- photo: 何を証拠または文脈として見せるかを決めてから選ぶ
- screenshot: 必要箇所へcropし、番号や注釈を静的に追加する
- illustration: 直接撮影できない概念、未来像、抽象的関係に限定する
- AI生成: 文章、ブランドロゴ、数値、チャートを生成させない。生成promptとtool情報を記録する

外部素材は事前にworkspaceへ保存し、取得元URL、作者、ライセンス、取得日、改変を記録する。レンダー時にnetworkへ取りに行かない。ライセンス不明素材を最終成果物へ含めない。

## Alt text

意味のある画像では、聞き手が視覚なしでも同じ要点を得られるaltを書く。

- 悪い: `棒グラフ`
- 良い: `問い合わせ上位3分類が全件数の72%を占め、配送確認が最大`

装飾画像は空altにし、manifestで`decorative: true`を明示する。

## Manifest minimum

各assetに `id`, `path`, `pages`, `type`, `source {kind, path, url}`, `license`, `alt`, `decorative`, `crop`, `generator`, `sha256` を持たせる。1つのassetを複数ページで使う場合は`pages`へ全ページ番号を入れる。
