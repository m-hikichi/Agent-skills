# JSON Video Studio MCP Server

JSONから動画を生成するstdio MCPサーバです。Node.js、Remotion、Chromium、FFmpeg、フォントはイメージ内にインストールするため、ホストにはDockerとCompose v2だけが必要です。

- `Dockerfile`：`runtime`（MCP・CLI）と`test`のイメージを構築。ビルドコンテキストはプラグインルート（`schemas/`と`examples/`を同梱するため）。
- `compose.yml`：VOICEVOX Engineと共通ネットワーク`json-video-studio`を起動。
- `src/`：実装（`mcp/`・`cli/`・`core/`・`render/`）。`tests/`はvitest。
- `../.mcp.json`：Claude Codeが`json-video-studio`イメージからMCPを起動する設定。

通常の導入は[プラグインREADME](../README.md#セットアップ)のセットアップを使います。手動で行う場合はプラグインルートで実行します。

```sh
docker build -t json-video-studio -f mcp-server/Dockerfile .
docker compose -f mcp-server/compose.yml up -d
docker run --rm --network json-video-studio json-video-studio doctor
```

CLIはMCPと同じ実装を使います。`validate`・`lint`・`resolve`・`storyboard`・`render`・`inspect`・`review-frames`があり、MCPを介さずに再生成・確認できます（`/workspace`に作業プロジェクトをマウントし、パスはworkspace相対で渡します）。レンダリング前のレビュー記録（`review.json`・`narration-review.json`）はCLIでも必要です。

```sh
docker run --rm --network json-video-studio -v "$PWD:/workspace" json-video-studio lint videos/demo/video-project.json
docker run --rm --network json-video-studio -v "$PWD:/workspace" json-video-studio review-frames videos/demo/dist/<project-id>/<lock-hash>
```

MCPは作業プロジェクトを`/workspace`、プラグインデータ（VOICEVOX音声キャッシュ）を`/data`へマウントします。ホストへポートを公開しないため、セッションごとに1コンテナを並行起動できます。ジョブの状態はコンテナ内だけに保持し、Claude Codeの終了（標準入力の切断）でコンテナも終了します。VOICEVOXはホストの`127.0.0.1:50021`、コンテナ間では`http://voicevox:50021`です。イメージ変更後はClaude Codeを再起動してください。

## テスト

```sh
docker build -t json-video-studio-test -f mcp-server/Dockerfile --target test .
docker run --rm --init json-video-studio-test
```

Remotion以外のツール（Node.js 24系、Chromium、FFmpeg、フォント、VOICEVOX）は版を固定せず、ビルド・pull時点の最新版を使います。実際の版はproject lockに記録されるため、更新後はlock生成とレビューをやり直します。基準画像（`tests/fixtures/golden/`）は、`examples/deck-slide`と`examples/diagrams`のstoryboardを描画し、目視で確認したうえで置き換えます。画像比較テストは軽微な描画差を許容します。基準画像との完全一致も検査する場合は`JSON_VIDEO_REQUIRE_EXACT_GOLDEN=1`を指定します。

## 実験的な英語TTS

Kokoroは`Dockerfile.english`で追加するオプションです。通常のDockerfileだけでは英語の外部音声・無音動画を扱えますが、英語音声の自動生成にはモデルを含む専用イメージが必要です。導入と原稿例は[プラグインREADME](../README.md#英語動画実験的対応)を参照してください。

プラグインルートで実エンジンのテストも実行できます。`--network none`で、モデル導入後の実行時にネットワークが不要なことを確認します。

```sh
docker build -t json-video-studio-english-test-core -f mcp-server/Dockerfile --target test .
docker build -t json-video-studio-english-tts-test --build-arg BASE_IMAGE=json-video-studio-english-test-core -f mcp-server/Dockerfile.english .
docker run --rm --init --network none json-video-studio-english-tts-test test
```

`tests/kokoro.test.ts`の実エンジンテストは、`JSON_VIDEO_KOKORO_MODELS`が設定された英語イメージで有効になります。通常のテストイメージでは、モデルを使わないキャッシュ・入力検証・レビュー・プロセス境界のテストを実行します。モデルはバージョン付きURLとSHA-256で固定し、Kokoroライブラリも版を固定します。取得したモデル・音声データのSHA-256、Python依存ライブラリの版、workerのSHA-256を`/opt/kokoro/models/manifest.json`へ記録し、そのfingerprintを生成音声の`voice.engineVersion`とキャッシュキーに含めます。
