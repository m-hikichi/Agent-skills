# marp-slide プラグイン

Claude Code の plugin として共有できる Marp スライド作成支援パッケージです。公式 docs の plugin 構造に合わせて、plugin root 直下に `skills/`、`agents/`、`hooks/`、`.mcp.json`、`.claude-plugin/plugin.json` を配置しています。

このプラグインは、要件整理、構成検証、design system 設計、slide plan 作成、Marp 本文作成、technical review、critical review、PDF/PNG export までを一連のワークフローとして扱います。technical reviewer と devil's advocate reviewer の両方が `pass` を返すまでタスクは完了できません。シングルエージェント、マルチエージェント、エージェントチームのいずれでも動作します。

## 構成

```text
plugins/marp-slide/
|-- .claude-plugin/
|   \-- plugin.json
|-- .mcp.json
|-- agents/
|   |-- devil-advocate-reviewer.md
|   |-- slide-reviewer.md
|   \-- structure-consultant.md
|-- hooks/
|   \-- hooks.json
|-- skills/
|   \-- main/
|       |-- SKILL.md
|       |-- references/
|       |   |-- design-reference-playbook.md
|       |   |-- layout-patterns.md
|       |   \-- presentation-structures.md
|       \-- templates/
|           |-- design-system-template.yaml
|           |-- outline-template.yaml
|           |-- presentation-starter.md
|           |-- request-template.yaml
|           |-- review-template.json
|           \-- slide-plan-template.yaml
|-- mcp-server/
|   |-- Dockerfile
|   |-- package.json
|   |-- tsconfig.json
|   \-- src/
|       \-- index.ts
\-- README.md
```

## 必要なもの

- Claude Code 1.0.33 以降
- Docker

ローカルの Node.js や Marp CLI は不要です。Marp CLI、Chromium、日本語フォントは Docker イメージ内で動作します。

## セットアップ

1. Docker イメージをビルドします

```bash
cd <path-to-this-repo>/plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

2. plugin をローカルで読み込みます

```bash
claude --plugin-dir <path-to-this-repo>/plugins/marp-slide
```

3. Claude Code で plugin のスキルを実行します

```text
/marp-slide:main
```

`/help` を実行すると、`marp-slide` 名前空間の下にスキルが表示されます。

## 共有方法

このフォルダ全体 `plugins/marp-slide/` をそのまま共有すれば plugin として配布できます。plugin docs の推奨どおり、`.claude-plugin/` の中には `plugin.json` だけを置き、それ以外の component はすべて plugin root レベルにあります。

## 生成される作業ファイル

```text
.slide-work/
|-- request.yaml
|-- outline.yaml
|-- design-system.yaml
|-- slide-plan.yaml
|-- review.json
|-- preview.html
|-- presentation.pdf
|-- presentation.pptx
\-- rendered-pages/
    |-- page-001.png
    |-- page-002.png
    \-- ...
```

## 主なコンポーネント

- `skills/main/SKILL.md`
  - ワークフロー、状態機械、完了条件の正本
- `agents/slide-reviewer.md`
  - technical review 判定と `review.json` 更新の正本
- `agents/devil-advocate-reviewer.md`
  - 聞き手の立場からのクリティカルレビュー。「文句のつけようがない」が pass の基準
- `agents/structure-consultant.md`
  - 批判的な視点での要件分析、ストーリーアーク提案、アウトライン検証
- `hooks/hooks.json`
  - review refresh と completion gate の hook 定義
- `.mcp.json`
  - `marp` MCP サーバー定義
- `mcp-server/`
  - Docker で動かす MCP サーバー実装

## 補足

- visual review のロジックは MCP の外にあります
- reviewer は生の Markdown ではなく、レンダリングしたページ画像を見て判定します
- 構成段階（S2-S3）で構成コンサルタントによる批判的検証を行い、検証を通過してからユーザーに提示します
- ドラフト完成後は technical review（構文・デザイン整合性・visual review）→ critical review（聞き手シミュレーション・So what テスト・説得力）の二段階で審査します
- シングルエージェントモードでは、メインエージェントが各 agent ファイルを読み、その手順を自分で実行します
- plugin 構造は Claude Code docs の「プラグインを作成する」に合わせています
