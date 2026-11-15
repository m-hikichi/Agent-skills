---
name: create-video
description: 日本語の企画、台詞、ローカル素材からvideo-project.jsonを作り、検証、VOICEVOX音声生成、storyboardレビュー、Remotionレンダー、成果物検査まで進める。JSONから解説動画、ナレーション動画、字幕付き動画、サムネイルを作りたい依頼で使う。
---

# JSON Video Studio create-video

動画制作を **Gather → Design → Draft → Validate → Resolve → Review → Render → Inspect** の8状態で進める。途中成果を再利用し、失敗時は直前の安全な状態から再開する。

品質は4つの観点で分けて扱う。前の観点が成立していても、後の観点の代わりにはならない。

| 観点 | 何を見るか | 誰が判定するか |
|---|---|---|
| A. 技術的な成立 | Schema、参照、解像度、フレーム、音声、同期、成果物 | 機械（`project_validate`・`resolve`・`output_inspect`） |
| B. 視認性 | 文字切れ、重なり、文字サイズ、コントラスト、字幕、余白、縮小表示 | 機械の実測（`project_lint`・`layoutMetrics`）＋ `video-reviewer` |
| C. 説明としての品質 | 視聴者との適合、具体例、用語の負荷、論理、正確さ、情報の優先順位 | `script-reviewer`（台本）＋ `video-reviewer` |
| D. 映像としての品質 | 視線の行き先、図解の形式、動きの意味、場面のつながり、反復 | `video-reviewer`（絵コンテ・完成動画） |

## 完了条件

次の条件をすべて満たしたときだけ完了とする。

1. 現在の`video-project.json`と`project.lock.json`のdigestが一致する。
2. `.json-video-work/<project-id>/review.json.status`が`pass`である（schemaVersion 2.0.0、B・C・Dの全gate）。
3. render jobが`succeeded`である。
4. `output_inspect`が同梱`project.lock.json`のSchema・自己ハッシュ・project digest・`totalFrames / fps`と、解像度1920×1080、30fps、H.264/AAC、yuv420p、音声・尺・必須成果物を確認している。
5. `project.lock.json`、`credits.txt`、`render-report.json`が成果物manifestに含まれている。
6. VOICEVOX音声がある場合、current lockの`narration-review.json`で全音声の合成原稿・生成かな・WAV hashを確認している。波形一致・音量・同期だけを読みのレビューの代わりにしない。
7. 完成MP4のフレーム（全scene、ページ切替、字幕切替、動きのある場面、640px縮小）を別agentが確認し、`final-review.json`がある。静止画レビューだけでアニメーションの滑らかさや音声を合格にしない。
8. 確認していないこと（聴感、動きの滑らかさなど）を最終報告で「未確認」と明記している。`output_inspect`が通ったことを、動画として良いことの根拠にしない。

## 共通ルール

- 正本は`../../schemas/video-project.schema.json`（プラグインルート基準では`schemas/video-project.schema.json`）。未知フィールドを推測して追加しない。
- プロジェクト外のファイル、絶対パス、URL、`..`、任意HTML/CSS/JavaScript/React、shell、SVGを入力へ書かない。
- 利用者が権利を説明できない素材は`rights.status: unknown`にする。`allowUnknownRights: false`のまま本番レンダーを迂回しない。
- 既存の出力を上書きしない。変更時は新しいlock hashの出力先を使う。
- 長時間処理は`*_start`のjob IDを保存し、`job_status`で追跡する。キャンセルは利用者が求めたときだけ`job_cancel`する。
- MCPのpathはworkspace相対POSIX path、作業領域はproject JSON所在ディレクトリ基準とする。詳細は`references/workflow.md`のpath契約を参照。
- 本番renderの前に必ずstoryboardをレビューする。
- ユーザーの事実関係や引用を勝手に補わない。調査・事実確認機能はない。題材がコードや仕様書として手元にある場合は、それを読んで確かめる。
- 利用者が明示した対象者・尺・表現方針は、このスキルの推奨より優先する。推奨と違う指定はrequestの`userDirectives`に記録し、reviewerへ渡す。

## S1. Gather（企画を決める）

1. 既存の`video-project.json`があれば`project_get`で読み、revisionとlock stateを確認する。
2. 新規なら、`templates/request.template.json`の`brief`を埋める。台本や画面を書く前に決める。
   - `audience`と`priorKnowledge`: 誰が見るか。何を知っていて、何を知らないか
   - `viewerQuestion`: 視聴者が抱えている疑問・困りごと（視聴者の言葉で1文）
   - `outcome`: 見終わったあと、何を理解・判断・実行できるようになるか
   - `coreMessage`: 動画全体で伝える中心の1文
   - `example`: 説明に使う具体例（1つの例を最初から最後まで追えるものが望ましい）
   - `inScope` / `deferred`: 本編で扱うことと、補足・別動画へ回すこと
   - `kind`: `explainer`（しくみの解説）・`howto`（操作手順）・`comparison`（比較）・`overview`（概要紹介）・`other`
3. 利用者が指定していない項目は、依頼文と素材から合理的に補って記入する。質問は、利用者にしか決められず、間違えると作り直しになる項目（対象者が読み取れない、題材の事実が分からない等）だけを1回にまとめる。補った項目は最終報告で示す。
4. 続けて、目標尺、話者（`speakers_list`の候補から選び、名前・style・利用規約の確認が必要なことを提示）、ローカル素材と権利、色・サムネイル文言を決める。
5. `.json-video-work/<project-id>/request.json`へ保存する。`project_lint`は`brief`の未記入を指摘する。

既定値は`youtube-1080p`、30fps、同梱固定フォント`Noto Sans CJK JP`、comfortable spacing、字幕2行、未知権利不許可、最大10分。別フォントは指定しない。

## S2. Design（台本と場面を設計する）

JSONを書く前に、`request.json`の`scenePlan`へ場面ごとの設計を書く。既存のカードや表に文章を流し込む作り方をしない。

### 台本

解説動画（`explainer`）の基本:

- **最初はタイトル画面にする。** 30秒以上の動画は、先頭に`title`の場面（タイトルと、誰向けの何の動画かを示す副題、3〜6秒）を置く。タイトルなしで説明から始めると、途中から始まったように見える（`project_lint`の`OPENING_TITLE_MISSING`）。省くのは利用者が指定した場合だけ。
- **タイトルの直後に、完成像か具体例を見せる。** 用語の定義を並べる前に、「何ができるのか」「何が困るのか」を見せ、見る理由を作る。
- **疑問から進める。** 各パートを「〜はどうなっているのか」という問いで始め、その答えとして説明する。
- **1つの具体例を追う。** `brief.example`を導入から結論まで使う。抽象的な説明だけのパートを続けない。
- **用語は必要になった場面で説明する。** 冒頭に用語集を置かない。
- **「何か」に加えて「なぜ必要か」「どう働くか」を言う。** 名前と役割の列挙で終わらせない。
- **見出しの読み上げや、同じ結論の繰り返しを削る。** 「次は〜です」だけのsceneを作らない。
- **尺は内容を削って合わせる。** `speedScale`は1.15以下にし、話速を上げて詰めない。

これは型の強制ではない。`howto`は完成形→手順→つまずく点、`comparison`は判断基準→比較→選び方、`overview`は全体像→要点、のように`kind`と利用者の指定に合う構成を選ぶ。30秒の告知に具体例の追跡を求めない。

正確さ（`references/quality-criteria.md`の「正確さ」を参照）:

- 主体（誰が何をするか）、通信方式、生成物を取り違えない。
- 「必ず」「ずれない」「同じになる」などの言い切りは、成立条件（端数処理、余韻時間、例外）を確かめる。条件付きなら条件を添える。`project_lint`の`ABSOLUTE_CLAIM`が候補を挙げる。
- 製品固有の仕様を、一般的な定義のように言わない（「このツールでは」と主語を付ける）。
- 数式・例の数値は、実装の条件と一致させる。

### 場面

各場面について、次を`scenePlan`に書いてからvisualを選ぶ。

| 項目 | 内容 |
|---|---|
| `message` | この場面で伝える1つのこと |
| `narration` | ナレーションが説明する内容（画面を読み上げるだけにしない） |
| `show` | 映像で見せると理解しやすくなること（関係・順序・変化・実物） |
| `focus` | 視聴者がどこを見ればよいか（主役は1つ） |
| `order` | 何をどの順番で表示・強調するか |
| `form` | 上の内容から決めた形式（`references/visual-guidelines.md`の「意味と形式の対応」） |

- **意味と形式を合わせる。** 流れは工程図、受け渡しは接続図、包含は入れ子、時間は同じ時間軸、比較は左右対比、設定は実物と結果の対応。包含を横並びカードで、時間関係を表で済ませない。
- **画面の文字はナレーションの写しにしない。** 画面は図・数値・短い語、説明はナレーション、と役割を分ける。本文・ポイント欄・字幕が同じ文になる構成を避ける。
- **主役に面積を与える。** 内容が少ないページは拡大・中央寄せにするか、図に置き換える。小さい文字と大きな空白を同居させない。
- **収まらない内容は縮小で解決しない。** 短くする、sceneやページを分ける、別の形式にする。
- **動きは、順序・因果・対応・変化を伝えるときだけ使う。** 同じ図が続く場面では図を出し直さず、変わる部分だけを動かす。

### 台本レビュー

`scenePlan`と台詞の案ができたら、`agents/script-reviewer.md`に従う別agentへ`request.json`（と、題材の原典があればそのパス）を渡し、`.json-video-work/<project-id>/script-review.json`を受け取る。音声生成より前に、構成・正確さ・形式の選択を直すためである。errorは修正して再レビューする（最大3回。3回目も残る場合は利用者へ示す）。

## S3. Draft

1. 新規プロジェクトは`project_create`を使う。大きな原稿をスクリプトで生成して配置した場合は、直後に`project_validate`と`project_get`を必ず通す。
2. `scenePlan.form`に従い、`references/visual-guidelines.md`からvisualを選ぶ。資料・規程・研修の解説では、`theme.frame.style: "deck"`と`slide`で関連内容を1ページにまとめる。見本資料が与えられたら、その配色・ロゴ・文字配置を作業プロジェクトの`palette`・`assets`で再現する。原典（規程など）がある場合は、条文を`text`ブロックに原文どおり引用し、金額表は`table`にする。レイアウト・scene JSONだけの依頼もこの手順で扱う。
3. sceneは次のいずれか1方式だけを使う。
   - ユーザー音声: `audioAssetId`。`durationMs`を書かない
   - VOICEVOX: `speakerId`と`text`。`audioAssetId`と`durationMs`を書かない
   - 無音: `durationMs`。`speakerId`と`audioAssetId`を書かない
4. 字幕:
   - 字幕は`theme.subtitleStyle.fontSize`を40以上にする（幅640pxで約13px）。長い台詞を小さい文字で1行に押し込まない。
   - 1行に収まらない台詞は、resolve時に文の切れ目で分割され、音声に合わせて順に表示される（`subtitleStyle.split: "auto"`が既定）。1 sceneの台詞は2〜3文までにし、文は読点で区切れる長さにする。
   - 強調が変わる位置がsceneの切れ目である。1つのsceneの中で、話題が次の強調対象へ移らないようにする。
5. 読み:
   - 略語・製品名・人名・数字・単位の読みを先に棚卸しする。画面表示は`text`/`subtitle`に残し、共通語は`pronunciations: [{term: "JSON", reading: "ジェーソン"}]`、文脈依存の発話はsceneの`speechText`で指定する。`speechText`は辞書より優先される完全な発話原稿なので、必要な読みをすべて含める。
   - 辞書は、エンジンが誤読した語だけに登録する。英数字を含む語はカタカナ、漢字の語はひらがなで登録する。漢字語をカタカナにすると未知語扱いでアクセント句が割れ、ひらがなの語が助詞と隣接すると助詞の読みが崩れる。複合語は長い語を短い語より先に置く。読みの候補は、resolve前に`speech_synthesize`の`kana`で一文ずつ試せる。
   - 利用者しか知らない読みは、仮の読みで進めてよいが、最終報告で必ず確認を求める。
6. 更新時は`project_update`へ読み取り時のrevisionを渡す。競合したら再読込し、利用者の変更を保持して再適用する。

## S4. Validate

1. `project_validate`を呼ぶ。Schemaエラーは`jsonPointer`の位置だけを最小修正する。semanticエラー（重複ID、参照切れ、図のnode/segmentの不整合、強調の範囲外など）が0件になるまで進まない。
2. `project_lint`を呼ぶ。指摘は機械が判定できる範囲の助言で、jobを止めない。各指摘について、直すか、直さない理由をrequestの`lintDecisions`に書く。warningを理由なく残さない。
   - `SUBTITLE_SMALL`・`SUBTITLE_TOO_LONG`・`SPARSE_SLIDE`・`CODE_TEXT_SMALL`・`DIAGRAM_LABEL_LONG`（視認性）
   - `OPENING_TITLE_MISSING`・`SPEECH_FAST`・`ABSOLUTE_CLAIM`・`TEXT_REPEATS_NARRATION`・`BRIEF_INCOMPLETE`（説明）
   - `NO_RELATIONAL_VISUAL`・`LONG_EMPHASIS_RUN`（映像）

## S5. Resolve

1. 先に`resolve_start`のdry-runを行い、VOICEVOX呼び出し件数、cache hit、推定尺、権利警告を確認する。
2. 問題がなければ通常の`resolve_start`を実行し、job IDをrequest記録へ保存する。
3. `job_status`が終端状態になるまで追跡する。
   - `succeeded`: lock hash、totalFrames、warningsを記録してReviewへ
   - `failed`: 構造化エラーの`jsonPointer`と`hint`を使って修正し、Validateから再開
   - `JOB_NOT_FOUND`（MCP再起動で状態が消えた）: 同じproject digestなら再実行。digestが変わっていればValidateから再開
4. 生成した音声のSHA-256、時間、VOICEVOX versionがlockへ入っていることを確認する。
5. 各`lock.assets[].voice.synthesisText`と`kana`を確認し、略語・固有名詞・数値の意図した読みと照合する。警告された未指定略語は、kanaで読みを確かめるか辞書へ登録する。
6. 分割された字幕は`lock.scenes[].subtitleCues`に入る。切替時刻は文ごとの発話長からの比例配分であり、音素単位の厳密な一致ではない。

## S6. Review

0. 音声がある場合、`agents/narration-reviewer.md`に従う別agentへproject、lock、音声WAVを渡し、`narration-review.json`を作成する。誤読は辞書/`speechText`を修正→再resolve→再確認する。かな照合と実際の聴取を区別し、聴いていなければ`listeningPerformed: false`とする。
1. `storyboard_start`を実行する。結果の`layoutMetrics`（カード下の空白率の実測）、`warnings`、`lint`を控える。空白率が0.3を超えるページは、拡大・中央寄せ・図への置き換え・統合のいずれかで直してから次へ進む。
2. Claude CodeのAgentツールで`subagent_type: video-reviewer`を指定し、次を渡す。
   - `video-project.json`、current `project.lock.json`、`request.json`（brief・scenePlan・userDirectives・lintDecisions）
   - storyboard/contact sheetのパス、`layoutMetrics`と`lint`の結果
   - 題材の原典（コード・仕様書・規程）があればそのパス
   - `review.json`の出力先、今回のiteration（1〜3）
3. `status`ごとに処理する。
   - `pass`: Renderへ
   - `missing_info`: `questionsForUser`を確認し、Designへ戻る
   - `fail`: `issues[].fix`を反映し、Validate → Resolve → storyboardを再実行。構成や形式の問題（C・D）はDesignへ戻って`scenePlan`から直す
4. failからの修正は最大3回。3回目もfailなら、未解決の問題と代表画像を利用者へ示し、要件変更を待つ。gateを無効化したり、未解決のまま合格として報告したりしない。

## S7. Render

1. project/lock digestとreview対象lock hashが一致することを再確認する。
2. `render_start`をfrozen lockで呼ぶ。入力JSONからAPIやリモート素材へアクセスさせない。
3. jobを追跡する。失敗時に部分出力を完成品として扱わない。
4. 成果物は`dist/<project-id>/<lock-hash>/`に新規生成する。

## S8. Inspect

1. `output_inspect`でMP4と成果物manifestを検査する（観点A）。
2. `output_review_frames`（成果物ディレクトリを渡す）で、完成MP4から次を抽出する。出力は`.json-video-work/<project-id>/final-frames/<lock-hash>/`（`index.json`に対応表）。ホストでFFmpeg等を使わない。
   - `scenes-*`: 全sceneの冒頭・中央・末尾
   - `continuing-*`: 同じページが続く境界の前後7フレーム
   - `page-change-*`: ページ切替の前後7フレーム（タイトルと最初のページを含む）
   - `cues-*`: 字幕の切替の前後
   - `motion-*`: 動きのある場面の7状態
   - `scaledFrames`: 各sceneの640×360の個別フレーム（縮小表示での可読性の確認用）
3. `captions.srt`の最終cueが動画尺を超えないこと、`chapters.txt`がsection順であること、サムネイルが1280×720であることを確認する。`credits.txt`の表記と`render-report.json`のlock hashを確認する。
4. フレームのシートと`index.json`を別agent（`video-reviewer`）へ渡し、`templates/final-review.template.json`の形で`final-review.json`を受け取る。確認する内容:
   - 強調対象と台詞・字幕の一致、ページ切替後に新しいページが読める状態になるまでの長さ、同じページが続く境界でのフェード・再入場・字幕の点滅の有無
   - 動きのある場面で、移動の途中と到着後が台詞と対応していること
   - タイトル・終了画面、文字量の多い場面、長い字幕
   - 640pxの個別フレームで、主要な文字と字幕が読めること
5. 完成MP4音声がレビューしたWAVに対応することを確認する。音声を聴ける環境では完成MP4を聴き、読み・抑揚・音量・語尾の切れ・不自然な間・発話と画面の対応を検査する。聴けない場合は「かな照合まで。聴感は未確認」と報告する。
6. 利用者へ報告する。
   - 出力ディレクトリ、動画尺、警告、クレジット上の注意
   - 補って決めた企画項目（brief）と、仮の読み
   - 確認したことと、確認していないこと（静止フレームは状態を示すだけで、動きの滑らかさは保証しない／音声は聴いていない、など）
   - 未解決のwarning

MCPの入出力と再開規則は`references/workflow.md`、画面の選び方は`references/visual-guidelines.md`、判定基準は`references/quality-criteria.md`を参照する。
