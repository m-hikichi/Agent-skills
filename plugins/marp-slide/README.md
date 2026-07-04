# marp-slide プラグイン

Claude Codeで、聞き手・目的・根拠・発表条件に合わせたMarp資料を作成するプラグインです。ストーリーボードを先に設計し、外部テーマとローカル画像/SVGで資料化し、作成者とは別のreviewerが全ページPNGを確認します。

## v0.8の変更点

- 固定archetypeと行数制限中心の評価を廃止
- 独立・厳格・証拠ベースのrubric v2へ変更
- inline CSSを外部テーマへ分離
- executive-clean / editorial / technicalの3テーマを追加
- proposal / executive-update / report / training / researchの完成例を分離
- ローカル画像、SVG、事前変換したMermaid図を許可
- ハッシュとreview attemptの計算をスクリプトへ移動

## 必要なもの

- Claude Code 1.0.33以降
- Docker
- bash
- `sha256sum`または`shasum`

## セットアップ

MCPサーバをビルドします。

```bash
cd plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

プラグインを読み込みます。

```bash
claude --plugin-dir <repo>/plugins/marp-slide
```

Claude Codeで実行します。

```text
/marp-slide:main
```

## ワークフロー

1. Gather: 聞き手、目的、発表形態、根拠、デザイン条件を確認
2. Storyboard: 各ページの役割、メッセージ、根拠、視覚表現を設計
3. Draft: 資料タイプに合うテーマと完成例を選んで作成
4. Review: 別reviewerがPDF/PNGとMarkdownをrubric v2で評価
5. Export: passしたソースから必要な形式を出力

## 外部テーマ

| theme | 主な用途 |
|---|---|
| `executive-clean` | 提案、経営更新、意思決定 |
| `editorial` | 分析報告、調査、研究 |
| `technical` | 研修、技術説明、手順 |

生成時は選んだCSSを `slides/theme.css` にコピーします。

```yaml
---
marp: true
theme: executive-clean
---
```

MCP出力ではthemeを指定します。

```text
marp_export(
  source: "slides/presentation.md",
  format: "pdf",
  output: ".slide-work/presentation.pdf",
  theme: "slides/theme.css"
)
```

themeは任意です。従来のinline CSSデッキもそのまま出力できます。

## rubric v2

### ハードゲート

- H1: 聞き手と目的への適合
- H2: must_includeの充足
- H3: 事実・数値・引用の根拠
- H4: 資料タイプに合うストーリー
- H5: レンダリング結果の可読性

### 5段階評価

- ストーリーと聞き手適合
- 根拠と内容の信頼性
- 視覚階層と図解の適切さ
- 統一感と完成度

全ハードゲートpass、全評価4以上、critical/majorなしでpassです。reviewerは問題ごとにスライド番号、観測事実、理由、修正案を記録します。

## 状態ファイル

```text
.slide-work/
|-- request.yaml
|-- storyboard.md
|-- review.json
|-- presentation.pdf
`-- rendered-pages/
slides/
|-- presentation.md
|-- theme.css
`-- assets/
    `-- SOURCES.md
```

旧rubricのreview.jsonはv0.8では無効です。現在のソースに対し `rubric_version: 2` で再レビューしてください。

## lint

lintは品質を判定せず、frontmatter、theme、ローカルアセット、枚数指定だけを確認します。

```bash
bash scripts/deck-lint.sh \
  --source slides/presentation.md \
  --target 10 \
  --slide-count-mode target \
  --theme slides/theme.css
```

`exact`だけが枚数不一致をFAILにします。`target`はWARN、`flexible`は判定しません。

## レビュー状態

レビュー開始前にスクリプトがハッシュとattemptを計算します。

```bash
bash scripts/review-gate.sh prepare
```

Stop hookはpass判定について次を確認します。

- rubric_versionが2
- source_sha256が現在のMarkdownと一致
- 全ページPNGを確認済み
- 5ハードゲートがpass
- 4評価がすべて4以上
- critical/major問題がない
