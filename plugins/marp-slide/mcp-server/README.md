# Marp MCP Server

Marp MarkdownをHTML、PDF、PPTX、ページ別PNGへ変換するDocker MCPサーバです。workspace内の任意のcustom theme CSSを `--theme-set` で読み込めます。

## build

```bash
docker build -t marp-mcp-server .
```

## tool

### marp_export

入力:

- `source`: workspace相対のMarkdownパス
- `format`: `html | pdf | pptx | png`
- `output`: 任意のworkspace相対出力パス
- `theme`: 任意のworkspace相対CSSパス

例:

```json
{
  "source": "slides/presentation.md",
  "format": "pdf",
  "output": ".slide-work/presentation.pdf",
  "theme": "slides/theme.css"
}
```

`theme`を指定した場合、ファイルがworkspace内にあり、拡張子が `.css` であることを検証してからMarpへ `--theme-set` として渡します。省略時はMarkdown内のinline styleまたはMarp既定テーマを使います。

PNG出力は `page-001.png` 形式へ正規化されます。source、output、themeの絶対パスとworkspace外参照は拒否します。

## Docker

`.mcp.json`はClaude Codeを起動したカレントディレクトリを `/workspace` にmountします。プロジェクトルートでClaude Codeを起動してください。

DockerイメージにはChromium、Noto Sans/Serif CJK JP、BIZ UDPGothic、Source Code Proを含みます。
