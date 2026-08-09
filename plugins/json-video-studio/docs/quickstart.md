# 動画生成フロー

## 事前条件

[READMEの「セットアップ（AI不要）」](../README.md#セットアップai不要)を最後まで実行し、runtime doctorとminimal project検証が成功していることを前提にします。導入・更新・再診断のコマンドと成功条件はREADMEだけで管理し、この文書では動画生成に必要な操作だけを説明します。

## 1. Claude Codeを起動

個人用プラグインを導入した場合は、新しいセッションを通常どおり起動します。

```sh
claude
```

リポジトリの変更を直接検証する場合は、代わりに次で起動します。

```sh
claude --plugin-dir /absolute/path/to/json-video-studio
```

## 2. 最初の動画

APIキーなしで描画だけを確認するには、`examples/minimal.video-project.json`をworkspaceへコピーし、validate → resolve → storyboard → render → inspectを依頼します。8種類のvisualをまとめてSchema検証するには`examples/all-templates.video-project.json`を使います。resolve前に`media` sceneの`assets/all-templates-media.png`を実在するローカル画像へ差し替え、権利情報も実素材に合わせて更新してください。

VOICEVOXを含む一連の確認には`examples/dialogue.video-project.json`を使います。サンプルのspeaker UUID/styleはEngine versionで存在を検証し、存在しない場合は`/speakers`の候補から選び直します。

自然言語から始める場合は、目的、視聴者、目標尺、台詞または構成、素材と権利、希望する色を伝えます。不明なデザイン項目はSkillが安全な既定値を使います。

MCP jobとCLIの結果に表示されるpathは、すべて`${CLAUDE_PROJECT_DIR}`基準のworkspace相対POSIX pathです。たとえば`projects/demo/video-project.json`を使う場合、lockとレビュー用ファイルは`projects/demo/.json-video-work/<project-id>/`、既定の最終成果物は`projects/demo/dist/<project-id>/<lock-hash>/`に作られます。

## 3. storyboardレビュー

resolve後、すぐ最終MP4を作らずstoryboardを生成します。`video-reviewer`が全sceneとサムネイルを8ゲートで検査します。current判定は`.json-video-work/<project-id>/review.json`、各回の不変な履歴は`reviews/<lock-hash>-<iteration>.json`へ保存されます。failならJSONを最小修正して再resolveし、最大3回まで再レビューします。

レビューを人が行いたい場合は`http://127.0.0.1:43120`を開き、JSONフォーム、draft/音声同期preview、storyboard、job進捗を確認します。Storyboard比較では2つのlock世代を選び、同じsceneを左右に並べて追加・削除・レイアウト変更を確認できます。UIとClaude Codeが同じprojectを編集した場合はrevision競合を解消してから続行します。

## 4. 成果物

最終成果物は次へ生成されます。

```text
dist/<project-id>/<lock-hash>/
  video.mp4
  project.lock.json
  captions.srt
  chapters.txt
  thumbnail.png
  storyboard/
  contact-sheet.png
  credits.txt
  render-report.json
  artifact-manifest.json
```

v0.1では`outputs.video`と`outputs.storyboard`は必ず`true`で、MP4とレビュー用storyboard/contact sheetを省略できません。`captions`、`chapters`、`thumbnail`の3点だけを`outputs`で任意に選べます。成果物ディレクトリにはレンダー時の`project.lock.json`が原子的に同梱され、`artifact-manifest.json`がそのlockを含む全成果物の相対path、サイズ、SHA-256を固定します。`inspect`は外部の作業ディレクトリに依存せず、lockのSchema・自己ハッシュ・project digest・総frame数/fpsと、manifest、report、実動画を相互検証し、欠落、余分なファイル、内容変更、動画尺の不一致を検出します。
