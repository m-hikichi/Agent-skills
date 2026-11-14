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
