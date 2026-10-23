# JSON Video Studio MCP Server 0.1.0

JSONから動画を生成するstdio MCPサーバのDocker構築設定です。Node.js、Remotion、Chromium、FFmpeg、フォントはイメージ内にインストールします。ホストにはDockerとCompose v2が必要です。

## ファイル

- `Dockerfile`：runtimeおよびtestイメージの構築。MCP実装は`../runtime/src/mcp/`。
- `compose.build.yml`：`json-video-studio:0.1.0`をビルド。
- `compose.voicevox.yml`：VOICEVOX Engineと共通ネットワーク`json-video-studio`を起動。
- `../.mcp.json`：Claude CodeがruntimeイメージからMCPを起動する設定。

ビルドコンテキストはプラグインルートです。`runtime/`、`schemas/`、`examples/`を参照し、除外設定にはルートの`.dockerignore`を使います。このディレクトリだけをコピーしてビルドすることはできません。

## 構築・起動

通常の導入・更新・診断は[プラグインREADME](../README.md#セットアップ)のOS別セットアップを使用してください。以下はこのディレクトリで実行する手動コマンドです。

```sh
docker compose -f compose.build.yml config --quiet
docker compose -f compose.build.yml build runtime
docker compose -f compose.voicevox.yml up -d
docker compose -f compose.voicevox.yml logs voicevox
```

VOICEVOXの起動完了後、プラグインを読み込んだ新しいClaude Codeセッションを開始します。`.mcp.json`が`node /app/dist/mcp/index.js`を標準入出力接続で起動します。MCPは常駐HTTPサービスではないため、`compose.build.yml`に対して`up`は実行しません。

MCPはプロジェクトを`/workspace`、プラグインデータを`/data`へマウントします。UIは`127.0.0.1:43120`、VOICEVOXは`127.0.0.1:50021`に公開します。コンテナ間の音声合成には`http://voicevox:50021`を使用します。音声生成のためruntimeは共通ネットワークへ接続します。

```sh
# CLIの起動確認（MCPと同じイメージ）
docker run --rm json-video-studio:0.1.0 --help
# VOICEVOXの停止（MCPのClaude Codeセッションを先に終了する）
docker compose -f compose.voicevox.yml down
# testステージのビルド
docker build -f Dockerfile --target test -t json-video-studio-test:0.1.0 ..
```

イメージ変更後はMCPを再起動してください。VOICEVOXイメージの既定版はComposeに固定され、必要な場合だけ`VOICEVOX_IMAGE`環境変数で変更できます。
