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

原稿・素材はClaude Codeで開いている作業プロジェクト内に置きます。**JSON検証 → 音声生成 → 読み・絵コンテレビュー → レンダリング → 完成動画レビュー**の順に制作します。スキル`/json-video-studio:create-video`を直接呼び出しても同じです。

- [音声・工程アニメーションの例](examples/animated-flow.video-project.json)
- [最小の無音例](examples/minimal.video-project.json)
- [資料型レイアウト（deck・slide）の無音例](examples/deck-slide.video-project.json)
- [原稿JSONの定義](schemas/video-project.schema.json)
- [画面の選び方](skills/create-video/references/visual-guidelines.md)

出力は原稿JSONの所在ディレクトリ配下の`dist/<project-id>/<lock-hash>/`です。動画・絵コンテ・クレジット・検証情報を保存し、字幕・章・サムネイルはJSONで選択します。作業用の音声・lock・レビューは`.json-video-work/`に保存します。既存出力は上書きしません。

動画は1920×1080・30fps。ローカル素材、VOICEVOXまたは提供音声、12種類の固定visual、章の進捗表示（`navigation`）、資料型レイアウト枠（`theme.frame`）に対応します。UIは`http://127.0.0.1:43120`、VOICEVOXは`http://127.0.0.1:50021`です。同時利用は1セッション・1レンダージョブを前提にします。

素材は原稿からの相対パスを使います。外部URL・任意コードの埋め込みはできません。作者・出典・ライセンスをJSONに記録し、出力のクレジットを保持してください。公開前にRemotionのライセンスとVOICEVOXキャラクターの利用規約を確認してください。本プラグイン固有コードには公開ライセンスを付与していません。

## 構成

```text
.claude-plugin/   プラグイン定義
.mcp.json         Docker内MCPの起動設定
commands/         /json-video-studio:video
skills/           制作手順（create-video）
agents/           独立レビュー（読み・画面）
schemas/          原稿JSON・lockの定義
examples/         原稿JSONの例
mcp-server/       MCPサーバの実装・テスト・Docker構築
scripts/          セットアップ
```

MCPが起動しない場合はセットアップを再実行します。VOICEVOXの状態は`docker compose -f mcp-server/compose.yml logs voicevox`で確認できます。手動構築とテストは[mcp-server/README.md](mcp-server/README.md)を参照してください。
