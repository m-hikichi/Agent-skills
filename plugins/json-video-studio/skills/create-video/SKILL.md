---
name: create-video
description: 日本語の企画、台詞、ローカル素材からvideo-project.jsonを作り、検証、VOICEVOX音声生成、storyboardレビュー、Remotionレンダー、成果物検査まで進める。JSONから解説動画、ナレーション動画、字幕付き動画、サムネイルを作りたい依頼で使う。
---

# JSON Video Studio create-video

動画制作を **Gather → Draft → Validate → Resolve → Review → Render → Inspect** の7状態で進める。途中成果を再利用し、失敗時は直前の安全な状態から再開する。

## 完了条件

次の条件をすべて満たしたときだけ完了とする。

1. 現在の`video-project.json`と`project.lock.json`のdigestが一致する。
2. `.json-video-work/<project-id>/review.json.status`が`pass`である。
3. render jobが`succeeded`である。
4. `output_inspect`が同梱`project.lock.json`のSchema・自己ハッシュ・project digest・`totalFrames / fps`と、解像度1920×1080、30fps、H.264/AAC、yuv420p、音声・尺・必須成果物を確認している。
5. `project.lock.json`、`credits.txt`、`render-report.json`が成果物manifestに含まれている。
6. VOICEVOX音声がある場合、current lockの`narration-review.json`で全音声の合成原稿・生成かな・WAV hashを確認している。波形一致・音量・同期だけを読みのレビューの代わりにしない。
7. 完成MP4の各sceneと動作中・境界のフレームを別agentが確認している。静止画レビューだけでアニメーション品質を合格にしない。聴感確認の有無は分けて報告する。

## 共通ルール

- 正本は`../../schemas/video-project.schema.json`。未知フィールドを推測して追加しない。
- プロジェクト外のファイル、絶対パス、URL、`..`、任意HTML/CSS/JavaScript/React、shell、SVGを入力へ書かない。
- 利用者が権利を説明できない素材は`rights.status: unknown`にする。`allowUnknownRights: false`のまま本番レンダーを迂回しない。
- 既存の出力を上書きしない。変更時は新しいlock hashの出力先を使う。
- 長時間処理は`*_start`のjob IDを保存し、`job_status`で追跡する。キャンセルは利用者が求めたときだけ`job_cancel`する。
- MCPへ渡すpathと`job_status.result`が返す全pathは`${CLAUDE_PROJECT_DIR}`基準のworkspace相対POSIX pathとして扱う。Docker内の`/workspace/...`へ読み替えたり、その絶対pathを利用者へ返したりしない。
- project JSONがサブディレクトリにある場合、lock、review、storyboardなどの`.json-video-work/`はworkspace直下ではなく、そのproject JSON所在ディレクトリ基準である。たとえば`videos/demo/video-project.json`の作業領域は`videos/demo/.json-video-work/<project-id>/`になる。
- 本番renderの前に必ずstoryboardをレビューする。
- ユーザーの事実関係や引用を勝手に補わない。初版には調査・事実確認機能がない。

## S1. Gather

1. 既存の`video-project.json`があれば`project_get`で読み、revisionとlock stateを確認する。
2. 新規なら、次を会話と与えられた素材から埋める。不明でも影響が小さい項目は既定値を採用し、重要な不明点だけをまとめて確認する。
   - 目的、視聴者、動画タイトル、目標尺
   - section構成と台詞
   - 話者。既定はVOICEVOXの利用可能speakersから1名を選ぶが、名前・style・利用規約を利用者に提示する
   - ローカル素材とそれぞれの権利情報
   - 色・字幕・サムネイル文言
3. `.json-video-work/<project-id>/request.json`へ`templates/request.template.json`の形で要件を記録する。

既定値は`youtube-1080p`、30fps、同梱固定フォント`Noto Sans CJK JP`、comfortable spacing、字幕2行、未知権利不許可、最大10分とする。v0.1では再現性を守るため、別フォントを指定しない。

## S2. Draft

1. 新規プロジェクトは`project_create`を使い、直接の無検証書き込みを避ける。
2. `references/visual-guidelines.md`からsceneごとに8種類のvisualを選ぶ。
3. sceneは次のいずれか1方式だけを使う。
   - ユーザー音声: `audioAssetId`。`durationMs`を書かない
   - VOICEVOX: `speakerId`と`text`。`audioAssetId`と`durationMs`を書かない
   - 無音: `durationMs`。`speakerId`と`audioAssetId`を書かない
4. 発話は字幕2行に収まる短さへ分割する。1 sceneに複数の論点を詰めない。
   - 略語・製品名・人名・数字・単位の読みを先に棚卸しする。画面表示は`text`/`subtitle`に残し、共通語は`pronunciations: [{term: "JSON", reading: "ジェーソン"}]`、文脈依存の発話はsceneの`speechText`で指定する。`speechText`は辞書より優先される完全な発話原稿なので、必要な読みをすべて含める。
   - 単に全文字を順番にfadeさせて動的解説としない。処理の流れは`flow`の共通stepsを保ち、発話単位で`activeStep`を進めて、入力・移動・到着・結果を対応させる。比較・変化を説明する動きには、その動きで理解できる内容をrequestへ記録する。
5. 更新時は`project_update`へ読み取り時のrevisionを渡す。競合したら再読込し、利用者の変更を保持して再適用する。

## S3. Validate

1. `project_validate`を呼ぶ。
2. Schemaエラーは`jsonPointer`の位置だけを最小修正する。
3. semanticエラーとして、重複ID、参照切れ、asset種別不一致、話者voice不足、metric labels/values長不一致、素材実体・MIME不一致、文字量、最大尺、権利情報を確認する。
4. エラーが0件になるまでResolveへ進まない。警告は利用者に要点を示し、review記録へ残す。

## S4. Resolve

1. 先に`resolve_start`のdry-runを行い、VOICEVOX呼び出し件数、cache hit、推定尺、権利警告を確認する。
2. 問題がなければ通常の`resolve_start`を実行し、job IDをrequest記録へ保存する。
3. `job_status`が終端状態になるまで追跡する。
   - `succeeded`: lock hash、totalFrames、warningsを記録してReviewへ
   - `failed`: 構造化エラーの`jsonPointer`と`hint`を使って修正し、Validateから再開
   - `interrupted`: 同じproject digestなら再実行。digestが変わっていればValidateから再開
4. 生成した音声のSHA-256、時間、VOICEVOX versionがlockへ入っていることを確認する。
5. 各`lock.assets[].voice.synthesisText`と`kana`を確認し、略語・固有名詞・数値の意図した読みと照合する。`kana`がない旧音声は再resolveする。警告された未指定略語を放置しない。

## S5. Review

0. 音声がある場合、`agents/narration-reviewer.md`に従う別agentへproject、lock、音声WAVを渡し、`.json-video-work/<project-id>/narration-review.json`を作成する。JSONを英字読みするなどの誤りは、辞書/`speechText`を修正→再resolve→再確認する。`engine-kana`の検査と実際の聴感検査を区別し、聴いていなければ`listeningPerformed: false`とする。読み確認なしでpassを作らない。
1. `storyboard_start`を実行し、contact sheetと各scene画像を生成する。
2. Claude CodeのAgentツールで`subagent_type: video-reviewer`を指定する。次を渡す。
   - `video-project.json`
   - 現在の`project.lock.json`
   - storyboard/contact sheetのパス
   - `.json-video-work/<project-id>/review.json`の出力先
   - 今回のiteration（1〜3）
   reviewerはcurrent `review.json`に加え、`reviews/<lockHash>-<iteration>.json`へ履歴を残す。
3. `status`ごとに処理する。
   - `pass`: Renderへ
   - `missing_info`: `questionsForUser`を確認し、Draftへ戻る
   - `fail`: `issues[].fix`を最小反映し、Validate → Resolve → storyboardを再実行
4. failからの修正は最大3回。3回目もfailなら問題と代表画像を利用者へ示し、要件変更を待つ。自動で品質ゲートを無効化しない。

## S6. Render

1. project/lock digestとreview対象lock hashが一致することを再確認する。
2. `render_start`をfrozen lockで呼ぶ。入力JSONからAPIやリモート素材へアクセスさせない。
3. jobを追跡する。失敗時に部分出力を完成品として扱わない。
4. 成果物は`dist/<project-id>/<lock-hash>/`に新規生成する。

## S7. Inspect

1. `output_inspect`でMP4と成果物manifestを検査する。
2. `captions.srt`の最終cueが動画尺を超えないこと、`chapters.txt`がsection順であること、サムネイルが1280×720であることを確認する。
3. `credits.txt`の既知素材・VOICEVOX表記と`render-report.json`のlock hashを確認する。
   - 完成MP4の全sceneの中間画像と、移動の開始・途中・到着・scene境界を抽出し、別agentへ再レビューを依頼する。強調対象と台詞の一致、前後での状態のつながり、表示時間を確認する。
   - 完成MP4音声がレビューしたWAVに対応することを確認する。音声を聴ける環境では完成MP4を聴き、略語の読み・抑揚・音切れを検査する。聴けない場合、かな照合と波形検査までであることを報告し、「音声品質すべて確認済み」としない。
4. 利用者へ出力ディレクトリ、動画尺、警告、クレジット上の注意だけを簡潔に報告する。

MCPの入出力と再開規則は`references/workflow.md`、JSONの選び方は`references/visual-guidelines.md`を参照する。
