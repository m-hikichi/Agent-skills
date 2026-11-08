# marp-slide

聞き手・目的・根拠から構成を設計し、写真、データchart、静的diagramを使ったMarp資料を制作するClaude Code pluginです。action-titleの論理検査、実内容入りデザイン案の統合確認、全ページ2倍PNG、machine QA、独立したaudience/content/visual reviewを経て仕上げます。

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
/marp-slide:create
```

## 全体構成

制作の流れは **設計 → 方向性確認 → 制作 → 検証・改善 → 納品** の5段階です。実行順序の正本は[SKILL.md](skills/slide-authoring/SKILL.md)です。以下のWorkflowは各段階の内訳です。

| 場所 | 責務 |
| --- | --- |
| skills/slide-authoring/SKILL.md | 制作の進行と各基準への入口 |
| skills/slide-authoring/guidelines/ | 論理・素材・表現・可読性・品質の基準 |
| skills/slide-authoring/templates/ | 要求・計画・レビュー記録の雛形 |
| skills/slide-authoring/design/ | 共通CSSテーマと部品見本 |
| skills/slide-review/ | 独立レビューの進行・統合・再検証 |
| commands/create.md | ユーザー向けの制作開始コマンド |
| agents/ | 初見・内容・視覚の独立レビュー |
| mcp-server/src/ | 固定環境での描画と機械測定 |
| scripts/marp-slide.mjs → scripts/lib/core.mjs | 状態管理、入力・レビュー検証、完了判定 |
| schemas/ | 計画・素材・描画・レビュー・状態の形式契約 |
| hooks/ | ライフサイクルの自動チェック |
| evals/ | 品質比較とgold deck回帰検証 |

検証で問題があれば制作へ戻ります。変更後は再レンダーし、新しい初見担当を含む三系統レビューを取り直します。独立した証跡をreview.jsonへ統合し、CLIが現行入力との一致と完了条件を検証します。

## Workflow

1. source inventoryと根拠ID
2. deck thesis、narrative spine、action-title ghost test
3. ページ別visual briefとvisual direction
4. 実内容入り3案とaction-title一覧の統合確認1回
5. 提供素材、data chart、静的diagram、Web／生成画像の順でasset制作
6. Marp compose、2倍PNG、contact sheet、machine QA
7. 初見audience reviewerの記録後、独立content reviewerとvisual reviewer
8. 必須の修正・再レンダー後にrubric v4 finalize

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
├── audience-review.json
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

`review.json`はrubric v4で、source、request、theme、asset manifest、参照／登録された全ローカルassetを含むartifact fingerprintへ結び付きます。いずれかを変更すると古いpassは失効します。renderer条件はfingerprintとは別にrender manifestへ固定versionとして記録します。finalizeにはrender 2以降と、現iterationに対応する具体的な改善記録が必要です。

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

`evals/` に、CSV付き経営提案、長い日本語見出しのread-ahead、SRE研修、研究不確実性、ブランド素材の5 fixtureがあります。v0.8 snapshotとのblind A/Bで、5件中4件以上の総合選好と、根拠忠実性・export成功率の非後退を受入条件にします。再現可能なworkspace作成、匿名化、受入集計、gold deck regressionのコマンドは[`evals/README.md`](evals/README.md)に集約しています。

## v1.1の品質契約

文献と原則・適用条件・良否例を対応させた[制作指針](skills/slide-authoring/guidelines/evidence-based-design.md)と[可読性基準](skills/slide-authoring/guidelines/readability.md)を追加。初見のaudience reviewer → content reviewerの照合と、独立visual reviewerの三系統で確認します。用途別文字サイズ、SVGの掲載時サイズ、コントラスト未測定箇所の明示と手動解決を検証します。

deck-plan schemaはv2、review rubricはv4です。既存planへ用語・説明時間・前提・理解確認の問いを追加し、旧レビューは再レンダー後に取り直してください。`.slide-work/audience-review.json`も納品証跡へ残します。renderer変更を適用するにはSetupのDockerイメージを再ビルドします。gold baselineは修正後の24枚を実画像で確認して更新済みです。以後も実画像を審査してから更新し、未審査のhashを承認済みとして登録しません。

## 構成変更

ユーザー向け入口は`commands/create.md`（`/marp-slide:create`）です。旧`main`は制作の`slide-authoring`とレビュー進行の`slide-review`へ分離しました。

`slide-authoring/guidelines`は判断基準、`templates`は記録の雛形、`design`はテーマCSSと部品見本です。完成見本はプラグイン直下の`evals/gold-decks`へ移し、品質検証に使います。案件固有CSSは引き続き`slides/theme.css`に置きます。

初見・内容・視覚のagentと完了条件は維持しています。gold資料・CSS・素材・承認済み画像hashは変更せず、baselineは移動した入力パスと実測入力fingerprintを更新しています。
gold資料24ページと3枚のcontact sheetを固定rendererで再生成し、承認済みbaselineの画像hash・寸法・描画環境との完全一致を確認しました。古くなっていた共通テーマ・素材フォルダの入力fingerprintを修正し、承認済み画像の記録は保持しています。対象資材の改行は.gitattributesでLFに固定します。

## ファイル整理

旧互換ラッパーの`deck-lint.sh`・`review-gate.sh`・`test.sh`は廃止しました。lint・review・finalizeは`run-cli.sh`または`run-cli.ps1`から実行します。Stop hookは従来どおりNode CLIを直接呼びます。

`run-state.json`はCLIが、`render-manifest.json`はrendererが生成するため、手動作成用の雛形は置きません。templatesには要求・構成・ページ計画・素材台帳・統合レビューの記入用雛形を残します。

開発時の回帰テストは次の2系統を実行します。

```sh
node --test scripts/tests/*.test.mjs evals/scripts/eval-harness.test.mjs
cd mcp-server
npm test
```

Nodeがない環境では、固定Dockerイメージ内のNodeから同じテストを実行できます。evalsのJSON・fixture・gold資料とその元データは品質検証・再現性のために保持します。
