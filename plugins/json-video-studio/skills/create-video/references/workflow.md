# MCPワークフロー契約

## 同期ツール

- `project_create`: Schema準拠の新規JSONをworkspace内へ作る。既存パスは上書きしない。
- `project_get`: project、revision、digest、`missing/current/stale`のlock stateを返す。
- `project_update`: expected revisionが一致したときだけ更新する。不一致は競合エラー。
- `project_validate`: Schemaとsemantic検証を行い、error/warningをJSON Pointer付きで返す。
- `ui_info`: loopback UIのURLと起動状態を返す。
- `job_status`: jobの状態、0〜1のprogress、message、result/errorを返す。
- `job_cancel`: 指定jobだけを安全に中断する。
- `output_inspect`: ffprobeと成果物manifestの検査結果を返す。

## 非同期ツール

- `resolve_start`: local assetとVOICEVOXを解決し、content-addressed cacheとlockを作る。`dryRun`ではファイルや音声を生成しない。
- `storyboard_start`: current lockから各scene静止画、contact sheet、サムネイル候補を作る。
- `render_start`: current/frozen lockから最終成果物を作る。

非同期ツールはすぐに`jobId`を返す。状態は`queued → running → succeeded|failed|cancelled`。サーバー再起動時に未完了だったjobは`interrupted`になる。

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

## 再現性

- `resolve`だけがVOICEVOXへ接続できる。Remotion componentとmetadata計算からネットワークへアクセスしない。
- 同じテキスト、speaker UUID、style ID、速度、音量、pitch、intonation、VOICEVOX Engine versionなら`${CLAUDE_PLUGIN_DATA}/cache/voicevox/`のcontent-addressed cacheをproject間で再利用する。
- current reviewは`.json-video-work/<project-id>/review.json`、各判定の不変な履歴は`reviews/<lock-hash>-<iteration>.json`へ保存する。
- renderは`--frozen-lock`で、hash不一致や欠落素材を検出したら失敗する。
- render後は固定済み`project.lock.json`も成果物へ原子的に同梱する。`artifact-manifest.json`はlockを含む成果物の相対path、size、SHA-256を固定し、`output_inspect`は同梱lockのSchema・自己ハッシュ・project digest・`totalFrames / fps`、manifestの欠落・余分・改変を検出する。
- animation、口パク、背景変化はframe番号から決定し、`Date.now()`、`Math.random()`、CSS時間animationを使わない。
