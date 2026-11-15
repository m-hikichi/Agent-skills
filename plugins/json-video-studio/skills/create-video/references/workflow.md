# MCPワークフロー契約

## 同期ツール

- `project_create`: Schema準拠の新規JSONをworkspace内へ作る。既存パスは上書きしない。
- `project_get`: project、revision、digest、`missing/current/stale`のlock stateを返す。
- `project_update`: expected revisionが一致したときだけ更新する。不一致は競合エラー。
- `project_validate`: Schemaとsemantic検証を行い、error/warningをJSON Pointer付きで返す。
- `project_lint`: 機械が判定できる品質上の助言を返す（projectは返さない）。`findings[]`は`code`・`severity`（warning/info）・`category`（legibility/explanation/visual）・`sceneIds`・`message`・`hint`・`evidence`を持つ。project所在ディレクトリの`.json-video-work/<project-id>/request.json`があれば、`brief`の未記入も指摘する。jobは止めない。
- `speakers_list`: VOICEVOX Engineの話者とstyle（`speakerUuid`、`styleId`）を返す。
- `speech_synthesize`: projectなしで一文を合成し、WAV（`.json-video-work/speech/<cacheKey>.wav`）、Engineの`kana`、長さを返す。`text`は合成原稿そのもので、辞書は適用しない。cacheは`resolve`と共有する。
- `job_status`: jobの状態、0〜1のprogress、message、result/errorを返す。
- `job_cancel`: 指定jobだけを安全に中断する。
- `output_inspect`: ffprobeと成果物manifestの検査結果を返す。
- `output_review_frames`: 成果物ディレクトリの`video.mp4`からフレームを抽出し、タイル状のシートと`index.json`を`.json-video-work/<project-id>/final-frames/<lock-hash>/`に作る（成果物ディレクトリは変更しない）。数分かかる。
  - `sceneSheets`（`scenes-*.png`）: 各sceneの開始+2・中間・終了-2フレーム
  - `boundarySheets`（`continuing-*.png`）: 同じレイアウトが続く境界の-6〜+6フレーム
  - `transitionSheets`（`page-change-*.png`）: ページが変わる境界（動画の先頭を含む）の-3, -1, 0, +2, +4, +8, +15フレーム
  - `cueSheets`（`cues-*.png`）: 字幕cueの切替の-1, +1, +8フレーム
  - `motionSheets`（`motion-*.png`）: 動きのある場面（`flow`、packet付きの`diagram`、cursor付きの`timeline`）の開始から0〜45フレームの7状態
  - `scaledFrames`: 各sceneの中間フレームの640×360個別ファイル（`frames/f<frame>.png`）と時刻
  - `limits`: このシートから判断できないこと（動きの滑らかさ、音声）

## 非同期ツール

- `resolve_start`: local assetとVOICEVOXを解決し、content-addressed cacheとlockを作る。`dryRun`ではファイルや音声を生成しない。
- `storyboard_start`: current lockから各scene静止画、contact sheet、サムネイル候補を作る。結果には`warnings`（字幕・表示時間・空白）、`layoutMetrics`（deckの各ページについて、描画結果から測ったカード下の空白率`blankBottomRatio`と`blankBottomPx`）、`lint`（`project_lint`と同じ指摘）が入る。字幕が分割される場面の静止画は、最も長いcueを表示する。
- `render_start`: current/frozen lockから最終成果物を作る。

非同期ツールはすぐに`jobId`を返す。状態は`queued → running → succeeded|failed|cancelled`。jobの状態はMCPサーバーのプロセス内だけに保持し、セッション間で共有しない。サーバー再起動後は以前の`jobId`を参照できないので、同じツールを再実行する。

## path契約

- ツールの入力pathと`job_status.result`内のすべてのpathは`${CLAUDE_PROJECT_DIR}`を基準にしたworkspace相対POSIX pathである。Claude Codeからそのまま参照でき、Docker内の`/workspace/...`という絶対pathは返らない。
- `video-project.json`がサブディレクトリにある場合、`.json-video-work/`と既定の`dist/`はそのJSON所在ディレクトリを基準にする。たとえばprojectが`videos/demo/video-project.json`ならlockは`videos/demo/.json-video-work/<project-id>/project.lock.json`、既定の動画は`videos/demo/dist/<project-id>/<lock-hash>/video.mp4`である。
- workspace外の絶対pathを成果物resultへ含めようとしたjobは、container pathを公開せずpolicy errorで失敗する。

## エラー

構造化エラーは次を返す。

```json
{
  "code": "PROJECT_SCHEMA_INVALID",
  "message": "Human-readable summary",
  "jsonPointer": "/sections/0/scenes/1/text",
  "hint": "Concrete correction",
  "retryable": false,
  "jobId": "optional-job-id"
}
```

終了コードは`0`成功、`2`Schema/設定、`3`依存/VOICEVOX、`4`render、`5`policy/security、`130`cancelである。

## 字幕と音声の同期

- sceneの長さは`ceil((音声の長さ + holdAfterMs) / 1000 × 30)`フレームで、sceneは前のsceneの終わりから始まる。画面・字幕・音声は同じ開始フレームに置かれる。フレーム単位への切り上げがあるため、音声の終わりとsceneの終わりは最大1フレーム未満ずれる。
- 1行に収まらない字幕は、resolve時に文の切れ目（。！？）で分割される（`theme.subtitleStyle.split: "none"`で無効）。行数の上限を超える1文は、中央に最も近い読点で分ける。隣り合う短い文は、1行に収まる限りまとめる。
- 分割した字幕（cue）の切替時刻は、発話している時間を各cueの重みで比例配分して決める。字幕が台詞そのもの（`subtitle`・`speechText`の指定なし、VOICEVOX音声）のときは、VOICEVOXの`audio_query`が返す各文の発話長（モーラ長とポーズ長の合計）を重みにする。それ以外（別の字幕文、`speechText`、利用者提供の音声）は文字数を重みにする。
- これは文単位の近似で、音素単位の強制アライメントではない。切替が発話より早い・遅いことがあり得るので、聴いて確認していない場合は「一致」と報告しない。
- cueは`lock.scenes[].subtitleCues`（scene開始からの相対フレーム）に入り、`captions.srt`はcueごとに1件になる。cueのない古いlockは、従来どおり字幕全体を表示する。
- 強調の切替はscene単位である。1つのsceneの中で強調対象を変えることはできないので、強調が変わる位置でsceneを分ける。

## レビュー記録

| ファイル（`.json-video-work/<project-id>/`） | 作る担当 | 段階 | コードのゲート |
|---|---|---|---|
| `script-review.json`、`reviews/script-<n>.json` | `script-reviewer` | Design（音声生成の前） | なし（スキルの手順で必須） |
| `narration-review.json`、`reviews/<lockHash>-narration.json` | `narration-reviewer` | Resolveの後 | レンダリング前に必須 |
| `review.json`、`reviews/<lockHash>-<n>.json` | `video-reviewer` | storyboardの後 | レンダリング前に必須 |
| `final-review.json`、`reviews/<lockHash>-final.json` | `video-reviewer` | レンダリングの後 | なし（完了条件） |

`review.json`は`schemaVersion: "2.0.0"`（視認性9・説明3・映像3の15 gate）で書く。レンダリングのゲートは次を要求する。

- current project/lockを対象とし、`status: "pass"`、iterationは1〜3
- 15 gateがすべて`true`。`variedPresentation`だけは、`notApplicableReasons`に理由がある場合に`"not_applicable"`も可
- `issues`はwarningだけで、各issueに`problem`・`fix`・`impact`・`evidence`と、`sceneId`または`timeSeconds`がある

`schemaVersion`のない従来形式（8 gate）のreviewも、既存プロジェクトのために受理する。

## 再現性

- VOICEVOXへ接続できるのは`resolve`（音声合成と、字幕cueの重みを得る`audio_query`）、`speakers_list`、`speech_synthesize`、`doctor`だけである。Remotion componentとmetadata計算からネットワークへアクセスしない。
- 同じテキスト、speaker UUID、style ID、速度、音量、pitch、intonation、VOICEVOX Engine versionなら`${CLAUDE_PLUGIN_DATA}/cache/voicevox/`のcontent-addressed cacheをproject間で再利用する。
- current reviewは`.json-video-work/<project-id>/review.json`、各判定の不変な履歴は`reviews/<lock-hash>-<iteration>.json`へ保存する。
- renderは`--frozen-lock`で、hash不一致や欠落素材を検出したら失敗する。
- render後は固定済み`project.lock.json`も成果物へ原子的に同梱する。`artifact-manifest.json`はlockを含む成果物の相対path、size、SHA-256を固定し、`output_inspect`は同梱lockのSchema・自己ハッシュ・project digest・`totalFrames / fps`、manifestの欠落・余分・改変を検出する。
- animation、口パク、背景変化はframe番号から決定し、`Date.now()`、`Math.random()`、CSS時間animationを使わない。
