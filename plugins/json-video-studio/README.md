# JSON Video Studio

JSON Video Studio `0.1.0`は、構造化JSONからVOICEVOX音声、字幕、storyboard、サムネイル、Remotion動画をローカル生成する**Claude Code専用・個人用**プラグインです。

元になった制作方式の紹介動画ではJSONに台詞、話者、表情、表示内容、BGM、背景、sectionを持たせています。ただし元のJSON Schemaやソースは公開されていないため、この実装は互換品ではなく独自仕様`json-video/v1`です。

## v0.1の範囲

- 1920×1080、30fpsの日本語動画
- ユーザー提供音声、またはVOICEVOXによるscene単位の音声生成
- 固定visual：title、bullets、split、media、code、quote、metric、outroと、工程間のデータ移動を描くflow
- 表示文と読み上げ文の分離（speechText）、語の読み指定（pronunciations）、VOICEVOX生成かなの記録と本番前の読み確認ゲート
- 音声時間に同期した字幕、section chapter、表情、任意の2フレーム口パク
- storyboard/contact sheetの別agentレビュー
- lockごとのStoryboard履歴と、scene単位の左右比較UI
- 必須のMP4・storyboard/contact sheetと、任意のSRT・chapters・thumbnail。credits、render report、成果物manifest、成果物へ同梱する再現用lockも生成
- 専用ローカルWeb UIとstdio MCP

Codex、Shorts、翻訳、画像生成、クラウドレンダー、動画投稿、任意React/HTMLテンプレートは含みません。

## セットアップ

このREADMEがセットアップ手順の唯一の正本です。導入・更新・動作診断はOS別スクリプトとDocker CLIだけで完了し、Claudeへの質問やセットアップ用Skillは必要ありません。Claude Codeを使うのは、セットアップ完了後に動画を作成するときだけです。

### 1. 必要環境を確認する

- Claude Code（プラグインとして利用する場合）
- Docker Desktop、またはDocker Engine + Docker Compose v2
- 初回のimage取得・buildに使うネットワークと数GB程度の空き容量
- macOS/LinuxではPOSIX互換`sh`と`tar`

プラグインルート（`.claude-plugin/plugin.json`があるディレクトリ）で、次がすべて成功することを確認します。

```sh
docker info
docker compose version
claude --version
```

Node.js、Chrome、FFmpeg、フォントをホストへ個別導入する必要はありません。固定版をDocker imageへ収録しています。UIは`127.0.0.1:43120`、VOICEVOXは`127.0.0.1:50021`だけへ公開します。v0.1はClaude Codeセッション1つ、render job 1件を前提にします。

実行前に[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)を読み、Remotionと、使用するVOICEVOXキャラクターごとの現行利用条件を確認してください。スクリプトの成功は、組織利用・サービス提供・生成物公開の許諾を意味しません。

### 2. 初回セットアップを実行する

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

macOS/Linux:

```sh
sh ./scripts/setup.sh
```

スクリプトは人やAIの判断を挟まず、次を順番に実行します。

1. DockerとComposeを確認し、Claude Codeがあればプラグインをstrict validationする。
2. `json-video-studio:0.1.0`をbuildする。
3. 固定版VOICEVOX Engineを起動し、APIと話者モデルを2秒間隔・最大60回の有限retryで待つ。
4. Node 24、workspace/dataの書き込み、Schema、FFmpeg/ffprobe、Chromium、Remotion 4.0.503、Notoフォント、VOICEVOX version/speakers、UIのloopback公開設定を`doctor`で検査する。
5. 同梱の`examples/minimal.video-project.json`をSchema検証する。
6. 未導入なら個人用`~/.claude/skills/json-video-studio`へstaging経由で原子的に配置する。

既存の個人用コピーや生成データは自動削除・上書きしません。最後に次の2行が表示されれば、AIを使わないセットアップ検証は完了です。

```text
Setup completed.
Runtime doctor and minimal project validation passed without AI assistance.
```

失敗した場合は表示された項目を修正して同じスクリプトを再実行します。[トラブルシューティング](docs/troubleshooting.md)にも決定的な確認手順があります。

### 3. 個人用プラグインを確認して起動する

初回セットアップ後に新しいターミナルで確認します。

```sh
claude plugin list --json
claude
```

一覧で`json-video-studio@skills-dir`がenabledになっていれば完了です。リポジトリの変更を直接試す場合、または個人用配置をskipした場合だけ、プラグインルートの絶対pathを指定します。

```sh
claude --plugin-dir /absolute/path/to/json-video-studio
```

`.mcp.json`やDocker imageを変更した場合は再build後に新しいClaude Codeセッションを開始してください。Skillやagent文書だけを変更した場合は、開発セッションで`/reload-plugins`を実行できます。

### 4. 既存の個人用コピーを更新する

セットアップスクリプトは既存の`~/.claude/skills/json-video-studio`を上書きしません。まず現在のディレクトリをバックアップ名へ移動し、その後、新しいソースのプラグインルートで通常のセットアップを再実行します。

Windows PowerShell:

```powershell
$installedPlugin = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.claude\skills\json-video-studio'
if (Test-Path -LiteralPath $installedPlugin) {
  Move-Item -LiteralPath $installedPlugin -Destination "$installedPlugin.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
}
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

macOS/Linux:

```sh
installed_plugin="$HOME/.claude/skills/json-video-studio"
if [ -e "$installed_plugin" ]; then
  mv "$installed_plugin" "$installed_plugin.backup-$(date +%Y%m%d-%H%M%S)"
fi
sh ./scripts/setup.sh
```

更新時は`SkipBuild`を使わず、manifest、image、doctor、minimal fixtureを一組として再検証してください。成功後に新しいClaude Codeセッションを起動します。バックアップは動作確認後も自動では削除されません。

### 5. セットアップオプションと再診断

- PowerShellの`-SkipBuild` / macOS・Linuxの`SKIP_BUILD=1`：既存の`json-video-studio:0.1.0` imageを使う。
- `-SkipVoicevox` / `SKIP_VOICEVOX=1`：VOICEVOXを起動しない。既存EngineがDocker network `json-video-studio`内の`http://voicevox:50021`で到達可能でなければdoctorは失敗する。
- `-SkipPersonalInstall` / `SKIP_PERSONAL_INSTALL=1`：個人用コピーを作らず、ソースを`--plugin-dir`で使う。

build・起動・コピーを省略して、現在のruntimeを再診断するコマンドは次のとおりです。`doctor`とminimal fixture検証は省略されません。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -SkipBuild -SkipVoicevox -SkipPersonalInstall
```

```sh
SKIP_BUILD=1 SKIP_VOICEVOX=1 SKIP_PERSONAL_INSTALL=1 sh ./scripts/setup.sh
```

## 動画を作る

セットアップ完了後、Claude Codeで動画作成用Skillを呼び出します。

```text
/json-video-studio:create-video を使って、3分の日本語解説動画を作ってください。
題材は○○、視聴者は○○です。まずstoryboardを確認したいです。
```

独自レイアウトを既存の8テンプレート制約内で設計するときだけ、`/json-video-studio:template-authoring`を使います。セットアップ用Skillはありません。

最小入力は[`examples/minimal.video-project.json`](examples/minimal.video-project.json)、全8テンプレート例は[`examples/all-templates.video-project.json`](examples/all-templates.video-project.json)、VOICEVOX例は[`examples/dialogue.video-project.json`](examples/dialogue.video-project.json)です。

読み方を指定して動きで工程を説明する例は[`examples/animated-flow.video-project.json`](examples/animated-flow.video-project.json)です。画面にはJSON、音声にはジェーソンを使い、同じ図のactiveStepを発話ごとに進めます。VOICEVOXを使う本番renderには、絵コンテのreview.jsonに加え、current lockの全音声について合成原稿・生成かな・WAV hashを照合したnarration-review.jsonが必要です。旧lockにかながない場合は再resolveしてください。手順は[読みレビュー担当](agents/narration-reviewer.md)を参照してください。かな照合と聴感評価は区別して記録します。

全8テンプレート例はSchema検証用です。`media`の`assets/all-templates-media.png`はplaceholderなので、resolve前に実在するローカル画像へ差し替え、`rights`もその素材に合わせて更新してください。詳しい生成順序は[動画生成フロー](docs/quickstart.md)を参照してください。

## プラグイン構成

```text
.claude-plugin/plugin.json  Claude Code manifest
.mcp.json                   Docker stdio MCP設定
skills/                     動画作成・template authoring用のプロンプトと参照資料
agents/video-reviewer.md    storyboard視覚QA
schemas/                    Draft 2020-12の編集JSON/lock契約
runtime/                    CLI、MCP、resolver、renderer、Web UI
examples/                   valid/invalid fixtures
scripts/                    AIを使わないOS別setup
```

編集JSONは[`schemas/video-project.schema.json`](schemas/video-project.schema.json)が唯一の正本です。lockは生成物であり、手編集しません。

## 開発・検証

```sh
docker build -t json-video-studio:0.1.0 .
docker run --rm json-video-studio:0.1.0 --help
docker build --target test -t json-video-studio-test:0.1.0 .
docker run --rm --init --entrypoint npm json-video-studio-test:0.1.0 test
docker run --rm --init json-video-studio-test:0.1.0
claude plugin validate . --strict
claude --plugin-dir .
```

test targetの`npm test`はSchema・security・timeline・job・MCPに加え、固定Chromiumで8 visualのpixel goldenと字幕の1〜2行境界を検査します。同一環境・同一lockの再生成は完全一致を要求し、検証済み基準画像との比較はx64/ARM間の微小な文字ラスタライズ差だけを許容します。既定entrypointはproduction adapterを使うPlaywright E2Eで、新規作成、sceneのドラッグ並べ替え、revision競合、stale lock、cancel、job復旧を確認し、実job queueでも無音サンプルをResolve → Storyboard → Render → 成果物確認まで完走します。

プラグインだけを変更した場合はClaude Codeで`/reload-plugins`を実行します。`.mcp.json`、Docker image、依存関係を変更した場合はimageを再buildし、新しいClaude Codeセッションで確認します。

個人用コピーの更新は[「既存の個人用コピーを更新する」](#4-既存の個人用コピーを更新する)の手順に従ってください。

## データと安全性

- assetはproject JSONからの相対パスだけです。絶対パス、URL、`..`、UNCを拒否します。
- MCP jobとCLIが返す成果物pathはすべて`${CLAUDE_PROJECT_DIR}`基準のworkspace相対POSIX pathです。project JSONをサブディレクトリへ置いた場合、`.json-video-work/`と既定の`dist/`もそのJSON所在ディレクトリ配下になります。
- remote asset、任意HTML/CSS/JavaScript/React、shell、未信頼SVGを受け付けません。
- 出力は`dist/<project-id>/<lock-hash>/`へ新規作成し、既存成果物を既定で上書きしません。
- 検証済みlockを他の成果物と同じ一時ディレクトリへ書き、manifest生成後にディレクトリ単位で原子的に公開します。成果物だけを移動しても`inspect`できます。
- 編集後はlockがstaleになり、再resolveまで本番renderできません。
- 素材の作者、出典、ライセンスをJSONへ記録し、`credits.txt`へ反映します。

## ドキュメント

- [動画生成フロー](docs/quickstart.md)
- [Schemaとデータの用意](docs/schema.md)
- [visual templateの選び方](docs/templates.md)
- [トラブルシューティング](docs/troubleshooting.md)
- [第三者ソフトウェアと利用条件](THIRD_PARTY_NOTICES.md)

このリポジトリ内のJSON Video Studio固有コードには、v0.1時点で公開ライセンスを付与していません。第三者コンポーネントと生成音声・素材の条件は別に確認してください。
