# marp-slide スキル

Marp（Markdown Presentation Ecosystem）を使ったスライド資料の作成・レビュー・エクスポートを支援する Claude Code スキルです。

## 特徴

- ヒアリング → 構成提案 → ドラフト → レビュー → 改善 の対話的ワークフロー
- 状態ファイル（`.slide-work/`）による進行管理
- slide-reviewer による自動レビュー（対象者適合、はみ出しリスク、エクスポート検証など）
- PostToolUse hook による `Write` / `Edit` / `MultiEdit` / `Bash` 後のレビュー再実行
- Stop hook による「最新レビュー未通過なのに終了」の防止

## セットアップ手順

### 必要な環境

- [Claude Code](https://claude.ai/claude-code) がインストール済みであること
- [Docker](https://www.docker.com/) がインストール済みであること

Node.js や Marp CLI のローカルインストールは不要です。Marp CLI、Chromium、日本語フォントはすべて Docker コンテナ内で動きます。

### 導入方法（4ステップ）

**ステップ 1**: `.claude/` をプロジェクトのルートにコピーします。

```bash
# <path-to-this-repo> は、このリポジトリのパスに置き換えてください
cp -r <path-to-this-repo>/skills/marp-slide/.claude/ <your-project>/.claude/
```

プロジェクトに既に `.claude/settings.json` がある場合は、中身をマージしてください。
既存の `hooks` がある場合は、`PostToolUse` と `Stop` の配列にこのスキルの hook を追加してください。

**ステップ 2**: `.mcp.json` をプロジェクトのルートにコピーします。

```bash
cp <path-to-this-repo>/skills/marp-slide/.mcp.json <your-project>/.mcp.json
```

既に `.mcp.json` がある場合は、`mcpServers` の中に `"marp"` の設定を追加してください。

**ステップ 3**: Docker イメージをビルドします。

```bash
cd <path-to-this-repo>/skills/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

**ステップ 4**: ビルドが成功したか確認します。

```bash
docker images | grep marp-mcp-server
```

これで導入完了です。

### MCP サーバーが提供するツール

| ツール名 | 説明 |
|---|---|
| `marp_export` | Marp Markdown を HTML / PDF / PPTX にエクスポート |
| `marp_check` | Marp Markdown のバリデーション（frontmatter、HTML タグ、テスト出力） |

### コピー後のプロジェクト構成

```
あなたのプロジェクト/
├── .claude/
│   ├── skills/
│   │   └── marp-slide/
│   │       └── SKILL.md           # スキル本体（ワークフロー定義）
│   ├── agents/
│   │   └── slide-reviewer.md      # レビュー契約 / reviewer
│   └── settings.json              # hooks 設定（自動レビュー・完了制御）
├── .mcp.json                      # MCP サーバー設定（Docker 経由で Marp CLI を実行）
├── .slide-work/                   # ← スキル実行時に自動生成される作業ディレクトリ
│   ├── request.yaml               #    ヒアリング結果
│   ├── outline.yaml               #    構成案
│   └── review.json                #    レビュー結果
└── slides/                        # ← スキル実行時に自動生成される出力ディレクトリ
    └── presentation.md            #    スライド本体
```

## 使い方

Claude Code で以下のように話しかけるだけです:

- 「スライドを作って」
- 「プレゼン資料を作成して」
- 「LT資料を作りたい」
- 「プロジェクト報告のスライドを作って」

スキルが自動的に起動し、ヒアリングから始まります。

## ファイルの役割

| ファイル | 役割 |
|---|---|
| `.claude/skills/marp-slide/SKILL.md` | スキル本体。ワークフロー、ルール、テンプレートを定義 |
| `.claude/agents/slide-reviewer.md` | レビュー契約。`review.json` を上書きし、8観点 + 検証結果を記録 |
| `.claude/settings.json` | hooks 設定。`Write` / `Edit` / `MultiEdit` / `Bash` 後の自動再レビューと、最新 review 未通過時の完了防止 |
| `.mcp.json` | MCP サーバー設定。Docker 経由で Marp CLI のエクスポート・バリデーションを実行 |
