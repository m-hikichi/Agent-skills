# marp-mcp-server 利用マニュアル

Marp Markdown ファイルを PDF・PPTX・HTML・PNG にエクスポートするための MCP サーバーです。Docker コンテナ内に Marp CLI、Chromium、日本語フォント (Noto Sans CJK) がすべて同梱されているため、ローカル環境への追加インストールは不要です。

## 前提条件

- Docker がインストール済みであること

## セットアップ

### 1. Docker イメージのビルド

```bash
cd plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

ビルドは初回のみ必要です。Dockerfile や依存パッケージを更新した場合は再ビルドしてください。

### 2. 動作確認

```bash
docker images marp-mcp-server
```

`marp-mcp-server` イメージが表示されればセットアップ完了です。

## 使い方

### 基本コマンド

Docker コンテナ内の Marp CLI を直接呼び出してエクスポートします。`-v` オプションでスライドがあるディレクトリをコンテナ内の `/workspace` にマウントし、`--entrypoint marp` で Marp CLI を直接起動します。

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "スライドファイル.md" --html --allow-local-files --pdf -o "出力ファイル.pdf"
```

> **Note:** Windows (PowerShell) の場合は `$(pwd)` を `${PWD}` に置き換えてください。
> ```powershell
> docker run --rm -v "${PWD}:/workspace" --entrypoint marp marp-mcp-server "スライドファイル.md" --html --allow-local-files --pdf -o "出力ファイル.pdf"
> ```

### PDF にエクスポート

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --allow-local-files --pdf -o "output/presentation.pdf"
```

### PPTX (PowerPoint) にエクスポート

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --allow-local-files --pptx -o "output/presentation.pptx"
```

### HTML にエクスポート

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --allow-local-files -o "output/presentation.html"
```

### PNG (スライド単位の画像) にエクスポート

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --allow-local-files --images png -o "output/slide.png"
```

スライドが複数ページある場合、`slide.001.png`、`slide.002.png`、... のように連番ファイルが生成されます。

## ソースファイルの要件

エクスポート対象の Markdown ファイルは、先頭に Marp フロントマターが必要です。

```markdown
---
marp: true
theme: default
paginate: true
---

# スライドタイトル

内容...

---

# 次のスライド

内容...
```

- `marp: true` がフロントマターに含まれていないとエクスポートに失敗します
- スライド区切りは `---` (水平線) です
- `--html` フラグにより、Markdown 内の HTML タグがそのままレンダリングされます

## オプション一覧

よく使う Marp CLI のオプションです。詳細は `docker run --rm --entrypoint marp marp-mcp-server --help` で確認できます。

| オプション | 説明 |
|---|---|
| `--pdf` | PDF 形式で出力 |
| `--pptx` | PPTX 形式で出力 |
| `--images png` | スライド単位の PNG 画像で出力 |
| `--images jpeg` | スライド単位の JPEG 画像で出力 |
| `--html` | Markdown 内の HTML タグを有効化 |
| `-o <path>` | 出力ファイルパスを指定 |
| `--theme <name>` | テーマを指定 (default, gaia, uncover) |
| `--allow-local-files` | ローカルファイル (画像など) の参照を許可 |

## Docker コンテナの構成

| 項目 | 内容 |
|---|---|
| ベースイメージ | `node:20-slim` |
| Chromium | `/usr/bin/chromium` (PDF/PNG レンダリング用) |
| 日本語フォント | `fonts-noto-cjk` (Noto Sans CJK) |
| Marp CLI | グローバルインストール済み |
| ワークスペース | `/workspace` (マウントポイント) |

## トラブルシューティング

### PDF/PNG が生成されない

Chromium 関連のエラーが出る場合は、`--no-sandbox` フラグを試してください。

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --pdf -o "output/presentation.pdf" \
  -- --no-sandbox
```

### 日本語が文字化けする

Docker イメージに `fonts-noto-cjk` が含まれているため、通常は発生しません。カスタムフォントを使いたい場合は、フォントファイルをマウントするか Dockerfile を拡張してください。

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  -v "/path/to/fonts:/usr/share/fonts/custom" \
  --entrypoint marp \
  marp-mcp-server \
  "slides/presentation.md" --html --pdf -o "output/presentation.pdf"
```

### 画像やローカルファイルが読み込まれない

Markdown から参照するファイルは、マウントしたディレクトリ内に存在する必要があります。相対パスで参照し、必要に応じて `--allow-local-files` を付けてください。

## MCP サーバーとしての利用 (Claude Code 連携)

Claude Code から MCP サーバーとして利用する場合は、marp-slide プラグインをロードすれば自動的に接続されます。手動での MCP サーバー操作は不要です。

```bash
claude --plugin-dir <path>/plugins/marp-slide
```

MCP サーバーは `marp_export` ツールを公開しており、Claude Code が `source` (入力ファイル)、`format` (html/pdf/pptx/png)、`output` (出力先) を指定して呼び出します。
