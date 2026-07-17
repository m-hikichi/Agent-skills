# Marp MCP Server v2

Marp 4.4.0、Vega-Lite、Mermaidを使い、workspace内の入力だけから静的なスライド成果物を生成するDocker MCPサーバです。実行時ネットワーク、workspace外参照、任意config、runtime Mermaid/Vega、editable PPTXは使用しません。

## Build / test

```bash
npm ci
npm test
docker build -t marp-mcp-server .
```

依存は `package.json` と `package-lock.json` で完全version固定されています。Node base imageはdigest、ChromiumとNoto CJKはDebian package version、追加fontはimmutable URLとSHA-256で固定します。Dockerは非root・read-only root filesystem・network noneで起動し、永続書込みはbind mountしたworkspaceだけです。

TypeScript 5.8は、Vega-Liteなど上流packageの巨大な型unionを展開しない`noCheck` transpileで実行物を作ります。local interfaceは明示型で境界を固定し、MCP tool登録、実Vega SVG、Mermaid、path/security、QAをDocker build内のruntime testで検証します。

## `marp_render_deck`

入力:

```json
{
  "source": "slides/presentation.md",
  "theme": "slides/theme.css",
  "formats": ["pdf", "png"],
  "output_dir": ".slide-work",
  "image_scale": 2
}
```

- `source`: 必須のworkspace相対 `.md`
- `theme`: 任意のworkspace相対 `.css`
- `formats`: `html | pdf | pptx | png` の重複なし配列。既定は `pdf, png`。visual review用PNGとcontact sheetは省略指定でも常に生成
- `output_dir`: 既定 `.slide-work`
- `image_scale`: 1〜4、既定2

標準成果物:

- `.slide-work/presentation.pdf`（PDF outlineあり、PDF notes注釈なし）
- `.slide-work/rendered-pages/page-001.png` …
- `.slide-work/contact-sheet.png`
- `.slide-work/presentation-notes.txt`
- `.slide-work/render-manifest.json`
- `.slide-work/machine-qa.json`

`presentation-notes.txt`は常に生成します。`read-ahead`でspeaker noteがない場合は空ファイルを正当な成果物として保持し、`live / hybrid`ではlifecycle lintが実presenter notesを必須にします。

`request.yaml` と `asset-manifest.json` は `output_dir` または `.slide-work` に必要です。manifestはsource/request/theme/assetsの統合fingerprint、全成果物hash、PNG寸法、CLI/Core/Chromium/font情報を記録します。machine QAはページ数、asset、overflow/clipping、最小文字サイズ、contrast、画像alt、manifest整合性を記録します。

`html: true` と `headingDivider` は受け付けません。スライド境界にはliteral `---`、動的HTMLの代わりには静的SVGを使います。local assetはMarkdown画像、reference-style画像、CSS、`backgroundImage` directiveから再帰追跡し、remote/data URLとactive SVGを描画前に拒否します。

## `marp_render_chart`

```json
{
  "spec": "slides/assets/volume.vl.json",
  "data": "slides/assets/volume.csv",
  "output": "slides/assets/volume.svg"
}
```

`data`は任意です。spec内のlocal `data.url` も読めます。CSV/TSV/JSONをinline valuesへ展開してからVega-Liteをcompileし、static SVGだけを書き出します。remote URL、href、image markは拒否します。

## `marp_render_diagram`

```json
{
  "source": "slides/assets/architecture.mmd",
  "output": "slides/assets/architecture.svg",
  "theme": "neutral",
  "background": "transparent"
}
```

入力は `.mmd | .mermaid`、出力は `.svg` です。init override、click callback、remote resource、script、foreignObjectを拒否し、決定的IDを使います。

## `marp_export` compatibility

旧interface `source / format / output? / theme?` を維持しています。内部では同じpath・asset検証とMarp実行器を使います。新規workflowではmanifestとQAを生成する `marp_render_deck` を使ってください。
