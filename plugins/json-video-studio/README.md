# JSON Video Studio 0.1.0

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

セットアップはイメージ構築、VOICEVOX起動、doctorとサンプルJSONの検証、未導入時の個人用配置を行います。成功時に `Setup completed.` と表示します。既存の個人用配置は上書きしません。

リポジトリを直接使う場合はPowerShellの `-SkipPersonalInstall`、shの `SKIP_PERSONAL_INSTALL=1` で配置を省略し、新しいセッションを起動します。
```sh
claude --plugin-dir /absolute/path/to/json-video-studio
```

個人用配置は `~/.claude/skills/json-video-studio` です。更新時はこのディレクトリをバックアップ名へ移動してからセットアップを再実行します。イメージ変更後はClaude Codeを再起動してください。

## 動画を作る

コマンドに動画の説明、または作業プロジェクト内の原稿JSONのパスを渡します。

```text
/json-video-studio:video 初心者向けにJSONの仕組みを説明する約1分の動画を作ってください。
/json-video-studio:video videos/demo/video-project.json
```

原稿・素材はClaude Codeで開いている作業プロジェクト内に置きます。コマンドは既存の制作スキルを使い、動画生成はDocker内のMCPで実行します。引数を省略した場合は会話内の依頼を使い、内容がなければ確認します。

既存のスキルも直接呼び出せます。

```text
/json-video-studio:create-video を使って、○○を説明する動画を作ってください。
視聴者は○○、目標は約○分。原稿・素材は○○です。
```

原稿JSONがある場合はそのパスを指定します。**JSON検証 → 音声生成 → 読み・絵コンテレビュー → レンダリング → 完成動画レビュー**の順に制作します。全台詞を文脈と照合し、誤読は修正・再生成します。生成かなの確認と実際の聴感確認は区別して記録します。

- [音声・工程アニメーションの例](examples/animated-flow.video-project.json)
- [最小の無音例](examples/minimal.video-project.json)
- [資料型レイアウト（deck・slide）の無音例](examples/deck-slide.video-project.json)
- [原稿JSONの定義](schemas/video-project.schema.json)
- [画面の選び方](skills/create-video/references/visual-guidelines.md)

出力は原稿JSONの所在ディレクトリ配下の `dist/<project-id>/<lock-hash>/` です。動画・絵コンテ・クレジット・検証情報を保存し、字幕・章・サムネイルはJSONで選択します。作業用の音声・lock・レビューは `.json-video-work/` に保存します。既存出力は上書きしません。

動画は1920×1080・30fps。ローカル素材、VOICEVOXまたは提供音声、12種類の固定visual（表・文章カード・複数ブロックを組むslideを含む）、章の進捗表示（`navigation`）、資料型レイアウト枠（`theme.frame`、配色は`palette`で指定）に対応します。完成動画の確認用に、`output_review_frames`でscene・境界のフレームシートを作れます。同じレイアウトが続くsceneは再フェードせず、強調だけを切り替えます。UIは `http://127.0.0.1:43120`、VOICEVOXは `http://127.0.0.1:50021` です。同時利用は1セッション・1レンダージョブを前提にします。

## 設定・診断

- [Docker/MCP構築設定](mcp-server/README.md)

構築や個人用配置を行わず再診断する場合:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipBuild -SkipVoicevox -SkipPersonalInstall
```
```sh
SKIP_BUILD=1 SKIP_VOICEVOX=1 SKIP_PERSONAL_INSTALL=1 sh ./scripts/setup.sh
```

## 構成と開発

起動できない場合は`docker image inspect json-video-studio:0.1.0`と`docker network inspect json-video-studio`を確認し、セットアップを再実行します。VOICEVOXの状態は`docker compose -f mcp-server/compose.voicevox.yml logs voicevox`で確認できます。原稿や素材の変更でlockが古くなった場合は、検証・音声生成・レビューをやり直します。

`mcp-server/` はDocker構築と、その配下の`runtime/`に実装とテストをまとめます。`schemas/` はJSON契約、`skills/create-video/` は制作手順、`commands/` はコマンド入口、`agents/` は独立レビューを担当します。`examples/`は制作向けの利用例、`mcp-server/runtime/tests/fixtures/`はテスト専用入力です。個人用配置は再ビルドできるようソースとテストを含め、両OSとも`scripts/install-files.txt`の同じ一覧を使用します。生成物や依存パッケージは配置対象に含めません。

```sh
docker build -f mcp-server/Dockerfile --target test -t json-video-studio-test:0.1.0 .
docker run --rm --init --entrypoint npm json-video-studio-test:0.1.0 test
docker run --rm --init json-video-studio-test:0.1.0
```

素材は原稿からの相対パスを使います。外部URL・任意コードの埋め込みはできません。作者・出典・ライセンスをJSONに記録し、出力のクレジットを保持してください。本プラグイン固有コードには公開ライセンスを付与していません。
