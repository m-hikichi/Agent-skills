# JSON Video Studio MCP Server

JSONから動画を生成するstdio MCPサーバです。Node.js、Remotion、Chromium、FFmpeg、フォントはイメージ内にインストールするため、ホストにはDockerとCompose v2だけが必要です。

- `Dockerfile`：`runtime`（MCP・CLI）と`test`のイメージを構築。ビルドコンテキストはプラグインルート（`schemas/`と`examples/`を同梱するため）。
- `compose.yml`：VOICEVOX Engineと共通ネットワーク`json-video-studio`を起動。
- `src/`：実装（`mcp/`・`cli/`・`core/`・`render/`・`web/`）。`tests/`はvitest、`e2e/`はPlaywright。
- `../.mcp.json`：Claude Codeが`json-video-studio`イメージからMCPを起動する設定。

通常の導入は[プラグインREADME](../README.md#セットアップ)のセットアップを使います。手動で行う場合はプラグインルートで実行します。

```sh
docker build -t json-video-studio -f mcp-server/Dockerfile .
docker compose -f mcp-server/compose.yml up -d
docker run --rm --network json-video-studio json-video-studio doctor
```

MCPは作業プロジェクトを`/workspace`、プラグインデータを`/data`へマウントし、UIを`127.0.0.1:43120`に公開します。VOICEVOXはホストの`127.0.0.1:50021`、コンテナ間では`http://voicevox:50021`です。イメージ変更後はClaude Codeを再起動してください。

## テスト

```sh
docker build -t json-video-studio-test -f mcp-server/Dockerfile --target test .
docker run --rm --init json-video-studio-test test          # vitest
docker run --rm --init json-video-studio-test               # Playwright e2e
```

Remotion以外のツール（Node.js 24系、Chromium、FFmpeg、フォント、VOICEVOX）は版を固定せず、ビルド・pull時点の最新版を使います。実際の版はproject lockに記録されるため、更新後はlock生成とレビューをやり直します。画像比較テストは軽微な描画差を許容します。基準画像との完全一致も検査する場合は`JSON_VIDEO_REQUIRE_EXACT_GOLDEN=1`を指定します。
