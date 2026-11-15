# JSON Video Studio

構造化JSONから音声付き動画を作るClaude Codeプラグインです。レンダリングと音声合成はDocker内で実行します。

## セットアップ

Docker Desktop（またはDocker Engine + Compose v2）とClaude Codeを用意し、プラグインルートで実行します。ホストへのNode.js・FFmpeg等のインストールは不要です。

Windows:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```
macOS/Linux:
```sh
sh ./scripts/setup.sh
```

イメージ構築、VOICEVOX起動、doctorとサンプルJSONの検証を行い、`~/.claude/skills/json-video-studio`が未作成ならプラグインをコピーします。成功時に`Setup completed.`と表示します。再実行すれば再構築・再診断できます。

既存の個人用配置は上書きしません。更新時はそのディレクトリを削除または退避してから再実行します。リポジトリを直接使う場合は`-SkipPersonalInstall`（shは`SKIP_PERSONAL_INSTALL=1`）を付け、次のように起動します。

```sh
claude --plugin-dir /absolute/path/to/json-video-studio
```

## 動画を作る

コマンドに動画の説明、または作業プロジェクト内の原稿JSONのパスを渡します。

```text
/json-video-studio:video 初心者向けにJSONの仕組みを説明する約1分の動画を作ってください。
/json-video-studio:video videos/demo/video-project.json
```

原稿・素材はClaude Codeで開いている作業プロジェクト内に置きます。**企画と場面の設計 → 台本レビュー → JSON検証・機械チェック → 音声生成 → 読み・絵コンテレビュー → レンダリング → 完成動画レビュー**の順に制作します。スキル`/json-video-studio:create-video`を直接呼び出しても同じです。

- [音声・工程アニメーションの例](examples/animated-flow.video-project.json)
- [最小の無音例](examples/minimal.video-project.json)
- [資料型レイアウト（deck・slide）の無音例](examples/deck-slide.video-project.json)
- [図解（接続図・入れ子・タイムライン・コードの行強調）の無音例](examples/diagrams.video-project.json)
- [原稿JSONの定義](schemas/video-project.schema.json)
- [画面の選び方（意味と形式の対応）](skills/create-video/references/visual-guidelines.md)
- [品質基準（技術・視認性・説明・映像）](skills/create-video/references/quality-criteria.md)

技術的な出力検査（`output_inspect`）と、動画としての品質評価（レビュー担当による視認性・説明・映像の判定）は別のものとして扱います。完成動画の検査は静止フレームで行うため、動きの滑らかさと音声の聴感は、視聴・聴取しない限り「未確認」と報告されます。

出力は原稿JSONの所在ディレクトリ配下の`dist/<project-id>/<lock-hash>/`です。動画・絵コンテ・クレジット・検証情報を保存し、字幕・章・サムネイルはJSONで選択します。作業用の音声・lock・レビューは`.json-video-work/`に保存します。既存出力は上書きしません。

動画は1920×1080・30fps。ローカル素材、VOICEVOXまたは提供音声、15種類の固定visual、章の進捗表示（`navigation`）、資料型レイアウト枠（`theme.frame`）、音声に合わせた字幕の分割表示に対応します。VOICEVOXは`http://127.0.0.1:50021`です。複数のClaude Codeセッションから同時に制作できます（同じ原稿JSONを同時に編集する使い方は除く）。MCPのコンテナはセッション終了時に停止し、ジョブの状態は引き継ぎません。

### 英語動画（実験的対応）

このブランチでは`meta.language`に`en-US`または`en-GB`を指定できます。英語音声は[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)と[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)でローカル生成します。モデルはイメージ構築時に取得・SHA-256検証し、生成時にはAPIキー・GPU・外部通信は不要です。米国英語20話者、英国英語8話者を選べます。画面・字幕・サムネイルも英語に対応し、字幕は英文の文・単語の境界で分割します。

既存の日本語用イメージと分けて試す場合は、プラグインルートで次を実行します。通常の`json-video-studio`イメージやMCP設定は置き換えません。

```sh
docker build -t json-video-studio-english-core -f mcp-server/Dockerfile .
docker build -t json-video-studio-english --build-arg BASE_IMAGE=json-video-studio-english-core -f mcp-server/Dockerfile.english .
docker run --rm --network none json-video-studio-english doctor --speech-provider kokoro
docker run --rm --network none -v "${PWD}:/workspace" -v json-video-studio-english-data:/data json-video-studio-english resolve examples/english-tts.video-project.json --dry-run
docker run --rm --network none -v "${PWD}:/workspace" -v json-video-studio-english-data:/data json-video-studio-english resolve examples/english-tts.video-project.json
```

`examples/english-tts.video-project.json`が音声自動生成用、`examples/english.video-project.json`が無音の表示確認用です。CLIの`storyboard`・`render`も同じイメージ名とマウントで実行します。`/data`の専用volumeは実行間の音声キャッシュを保持します。英語のみの制作にはVOICEVOXへの接続は不要です。MCP用の設定例は`.mcp.english.json`です。実験用設定として使い、既存の`.mcp.json`は保持してください。この設定例は`--network none`で英語用エンジンのみを使います。MCPの`doctor`には`speechProvider: "kokoro"`を渡します。

英語の話者には`provider: "kokoro"`、`voiceId`、`language`を指定します。米国英語は`af_heart`・`am_michael`など、英国英語は`bf_emma`・`bm_george`などです。`language`はプロジェクトの言語と一致させます。`speedScale`（0.5〜2）・`volumeScale`（0〜2）も指定できます。日本語は従来どおりVOICEVOXで生成し、プロバイダーと言語の組み合わせが違う場合は検証エラーになります。

```json
{
  "speakers": [{
    "id": "narrator", "displayName": "Narrator",
    "voice": {"provider": "kokoro", "voiceId": "af_heart", "language": "en-US"}
  }],
  "scene": {
    "id": "intro", "speakerId": "narrator",
    "text": "Welcome. This video explains the workflow.",
    "visual": {"type": "title", "title": "The workflow"}
  }
}
```

上記は設定箇所の抜粋です。`scene`は実際の`sections[].scenes[]`へ配置し、音声生成のsceneには`audioAssetId`・`durationMs`を書きません。`text`が字幕と音声原稿の既定値になり、読み上げだけ変える場合は`speechText`を指定します。既存の外部音声（WAV・MP3・M4A・OGG）も`assets`と`audioAssetId`で取り込めます。無音のsceneは`text`を使わず、`subtitle`と`durationMs`を指定します。

`english_voices_list`で利用可能な話者を取得し、`english_speech_synthesize`でprojectを作る前に試聴用WAVを生成できます。試聴と`resolve`はキャッシュを共有します。キャッシュキーには原稿・話者・言語・速度・音量と、モデル・音声データ・実行ライブラリ・workerの識別情報を含み、lockには生成条件とWAVのハッシュを記録します。クレジットにもKokoroの話者とモデルライセンスを記録します。

Kokoroと提供音声の字幕タイミングは文字量による配分で、単語ごとの音声認識・位置合わせは行いません。短い文ごとにsceneを分け、発音・字幕切替・改行を確認してください。日本語向けの読み辞書・かな照合は英語には適用しません。Kokoro音声の本番レンダーには、実音声の聴取を記録した`narration-review.json`（`method: "listening"`）が必要です。未聴取のままpassにはできません。記録例は`agents/narration-reviewer.md`を参照してください。

素材は原稿からの相対パスを使います。外部URL・任意コードの埋め込みはできません。作者・出典・ライセンスをJSONに記録し、出力のクレジットを保持してください。公開前にRemotionのライセンスとVOICEVOXキャラクターの利用規約を確認してください。本プラグイン固有コードには公開ライセンスを付与していません。

## 構成

```text
.claude-plugin/   プラグイン定義
.mcp.json         Docker内MCPの起動設定
commands/         /json-video-studio:video
skills/           制作手順（create-video）
agents/           独立レビュー（台本・読み・画面と完成動画）
schemas/          原稿JSON・lockの定義
examples/         原稿JSONの例
mcp-server/       MCPサーバの実装・テスト・Docker構築
scripts/          セットアップ
```

## 既存プロジェクトとの互換性

原稿JSONの`schemaVersion`は`1.0.0`のままで、追加した項目はすべて任意です。既存の原稿・lock・review（8 gateの従来形式）はそのまま使えます。再レンダリングすると次の見た目が変わります。

- 表紙・終了画面・サムネイルは背景が全面になり、下部の白い帯はロゴ（`coverLogoAssetId`）があるときだけ描かれます。
- 強調されていない要素が濃くなります（読める濃さを保つため）。
- ページ切替は、前のページをフェードアウトさせず、次のページを短く表示させる形になります。
- `slide`の`steps`の見出しは「第N章」から番号になります。章として見せる場合は`"numbering": "chapter"`を指定します。
- 再resolveすると、1行に収まらない字幕が文ごとに分割されます。従来どおり全文を出す場合は`theme.subtitleStyle.split: "none"`を指定します。

イメージを作り直したあとは、Claude Codeを再起動し、lock生成とレビューをやり直してください。

MCPが起動しない場合はセットアップを再実行します。VOICEVOXの状態は`docker compose -f mcp-server/compose.yml logs voicevox`で確認できます。手動構築とテストは[mcp-server/README.md](mcp-server/README.md)を参照してください。
