# marp-slide

聞き手・目的・根拠から構成を設計し、写真、データchart、静的diagramを使ったMarp資料を制作するClaude Code pluginです。action-titleの論理検査、実内容入りデザイン案の統合確認、全ページ2倍PNG、machine QA、独立したcontent/visual reviewを経て仕上げます。

## Setup

- Claude Code 1.0.33以降
- Docker（固定Marp renderer / MCP）

Node.js 20以降がホストにあればlifecycle CLIは直接実行します。Nodeがない環境では同梱launcherがDocker image内のNodeへ自動的にfallbackします。

```bash
cd plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
claude --plugin-dir <repo>/plugins/marp-slide
```

Claude Codeで呼び出します。

```text
/marp-slide:main
```

## Workflow

1. source inventoryと根拠ID
2. deck thesis、narrative spine、action-title ghost test
3. ページ別visual briefとvisual direction
4. 実内容入り3案とaction-title一覧の統合確認1回
5. 提供素材、data chart、静的diagram、Web／生成画像の順でasset制作
6. Marp compose、2倍PNG、contact sheet、machine QA
7. 独立content reviewerとvisual reviewer
8. 必須の修正・再レンダー後にrubric v3 finalize

新規案件の作業領域はcross-platform CLIで作ります。

```powershell
& "$env:CLAUDE_PLUGIN_ROOT/scripts/run-cli.ps1" init --root .
```

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/run-cli.sh" init --root .
```

## Renderer tools

```text
marp_render_deck({
  source: "slides/presentation.md",
  theme: "slides/theme.css",
  formats: ["pdf", "png"],
  output_dir: ".slide-work",
  image_scale: 2
})
```

- `marp_render_deck`: PDF/PNG/HTML/PPTX、notes、render manifest、machine QAを同じ固定環境で生成
- `marp_render_chart`: Vega-Lite specとCSV/JSONから静的SVGを生成
- `marp_render_diagram`: Mermaid sourceから静的SVGを生成
- `marp_export`: 既存呼び出し向けの互換wrapper

通常PPTXはレンダリング画像を格納するため、object単位で編集できません。editable PPTXは標準対象外です。

## Artifacts

```text
.slide-work/
├── request.yaml
├── storyboard.md
├── deck-plan.json
├── asset-manifest.json
├── render-manifest.json
├── machine-qa.json
├── content-review.json
├── visual-review.json
├── review.json
├── run-state.json
├── contact-sheet.png
├── presentation.pdf
├── presentation-notes.txt
└── rendered-pages/page-001.png ...
slides/
├── presentation.md
├── theme.css
└── assets/
```

`review.json`はrubric v3で、source、request、theme、asset manifest、参照／登録された全ローカルassetを含むartifact fingerprintへ結び付きます。いずれかを変更すると古いpassは失効します。renderer条件はfingerprintとは別にrender manifestへ固定versionとして記録します。finalizeにはrender 2以降と、現iterationに対応する具体的な改善記録が必要です。

`run-state.json`は`active / needs_user / blocked / complete`を取り、確認待ちや外部阻害でも`completed: false`を維持します。`complete`は`finalize`だけが設定し、完了後のstateは変更できません。

notesファイルは全deckで生成します。`read-ahead`は空のnotes artifactを許容し、`live / hybrid`は実内容を持つMarpit presenter notesがlint必須です。

## Theme and examples

themeは `base + profile + deck tokens` から単一の `slides/theme.css` へcompileします。互換用の自己完結themeと3本のgold deckも同梱しています。

- executive decision：比較chart、選択肢、判定gate、roadmap
- analytical read-ahead：方法、cohort/segment chart、限界、実験設計
- technical training：structure diagram、annotated log、exercise、presenter notes

旧5例とHTML starterはcomponent galleryへ再編しました。frontmatterのHTML実行許可、CSS幅の疑似bar chart、runtime Mermaid/Vegaは使用しません。

## Constraints

- 確認できない数値は仮説または要確認として表示
- 外部素材はURL、license、取得日をmanifestへ記録
- AI画像は背景・概念illustrationに限定し、文章・数値・chartを描かせない
- 全ページPNGを実際に開いたvisual reviewなしでpassにしない
- geometry checkが`not_run`のmachine QAはpassとして扱わない
- workspaceの任意Marp config、workspace外のCSS/SVG参照、runtime JavaScriptを読み込まない

## Evaluation

`skills/main/evals/` に、CSV付き経営提案、長い日本語見出しのread-ahead、SRE研修、研究不確実性、ブランド素材の5 fixtureがあります。v0.8 snapshotとのblind A/Bで、5件中4件以上の総合選好と、根拠忠実性・export成功率の非後退を受入条件にします。再現可能なworkspace作成、匿名化、受入集計、gold deck regressionのコマンドは[`skills/main/evals/README.md`](skills/main/evals/README.md)に集約しています。
