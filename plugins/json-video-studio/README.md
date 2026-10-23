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

```text
/json-video-studio:create-video を使って、○○を説明する動画を作ってください。
視聴者は○○、目標は約○分。原稿・素材は○○です。
```

原稿JSONがある場合はそのパスを指定します。**JSON検証 → 音声生成 → 読み・絵コンテレビュー → レンダリング → 完成動画レビュー**の順に制作します。全台詞を文脈と照合し、誤読は修正・再生成します。生成かなの確認と実際の聴感確認は区別して記録します。

- [音声・工程アニメーションの例](examples/animated-flow.video-project.json)
- [最小の無音例](examples/minimal.video-project.json)
- [JSONの書き方](docs/schema.md)
- [画面の選び方](skills/create-video/references/visual-guidelines.md)

出力は原稿JSONの所在ディレクトリ配下の `dist/<project-id>/<lock-hash>/` です。動画・絵コンテ・クレジット・検証情報を保存し、字幕・章・サムネイルはJSONで選択します。作業用の音声・lock・レビューは `.json-video-work/` に保存します。既存出力は上書きしません。

動画は1920×1080・30fps。ローカル素材、VOICEVOXまたは提供音声、9種類の固定visualに対応します。UIは `http://127.0.0.1:43120`、VOICEVOXは `http://127.0.0.1:50021` です。同時利用は1セッション・1レンダージョブを前提にします。

## 設定・診断

- [Docker/MCP構築設定](mcp-server/README.md)
- [トラブルシューティング](docs/troubleshooting.md)
- [第三者ソフトウェア・音声の利用条件](THIRD_PARTY_NOTICES.md)

構築や個人用配置を行わず再診断する場合:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipBuild -SkipVoicevox -SkipPersonalInstall
```
```sh
SKIP_BUILD=1 SKIP_VOICEVOX=1 SKIP_PERSONAL_INSTALL=1 sh ./scripts/setup.sh
```

## 構成と開発

`mcp-server/` はDocker構築、`runtime/` は実装とテスト、`schemas/` はJSON契約、`skills/create-video/` は制作手順、`agents/` は独立レビューを担当します。`examples/`は制作向けの利用例、`runtime/tests/fixtures/`はテスト専用入力です。個人用配置は再ビルドできるようソースとテストを含め、両OSとも`scripts/install-files.txt`の同じ一覧を使用します。

```sh
docker build -f mcp-server/Dockerfile --target test -t json-video-studio-test:0.1.0 .
docker run --rm --init --entrypoint npm json-video-studio-test:0.1.0 test
docker run --rm --init json-video-studio-test:0.1.0
```

素材は原稿からの相対パスを使います。外部URL・任意コードの埋め込みはできません。作者・出典・ライセンスをJSONに記録し、出力のクレジットを保持してください。本プラグイン固有コードには公開ライセンスを付与していません。
