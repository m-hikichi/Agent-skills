---
name: main
description: Marp スライドの要件収集、ストーリーボード設計、ドラフト作成、批判的レビュー、PDF/PNGエクスポートを行うスキル。レビューは `reviewer` サブエージェントが別コンテキストで実施し、現在の `slides/presentation.md` と一致する `.slide-work/review.json.status == "pass"` になるまで完了しない。4 状態のワークフロー（Gather → Draft → Review → Export）で進める。
model: opus
effort: xhigh
---

# Marp Slide スキル

## 目的

Marp スライドを 4 状態のワークフローで作成する:

1. **S1. Gather** — 要件を会話で収集し `.slide-work/request.yaml` を埋める
2. **S2. Draft** — S2a でストーリーボードを固め、S2b で `slides/presentation.md` を作成する
3. **S3. Review** — `reviewer` サブエージェントが批判的に審査し、必要なら main agent が修正して再実行する（最大 3 回）
4. **S4. Export & Approve** — PDF/PNG を最終確認し、ユーザーに完了報告する

**完了の唯一の条件は、現在の `slides/presentation.md` の `source_sha256` と一致する `.slide-work/review.json.status == "pass"`** です。他の条件で完了扱いにしてはいけません。

## 重要な設計原則

- **レビューは別 AI が行う**: ドラフトを作った main agent ではなく、`reviewer` サブエージェントが判定します。Claude Code の Agent ツールで `subagent_type: reviewer` を指定して呼び出します
- **サブエージェント不可時は完了不可**: `reviewer` サブエージェントを起動できない環境では、既存の `exact_fix_instructions` が具体的なら main agent が `slides/presentation.md` に適用してよい。その後 `.slide-work/review-blocked.json` を書いて停止し、`.slide-work/review.json.status = "pass"` を自分で作って完了扱いにしてはいけません。ユーザーに「reviewer を起動できないため完了ゲートを通せない」と報告します
- **ゲートは 12 個だけ**: reviewer は 12 個のハードゲート（ストーリー 6 + ビジュアル 6）だけを見ます。詳細は `../../agents/reviewer.md`
- **修正ループは最大 3 回**: S3 で 3 回連続 fail ならユーザーに相談して判断を仰ぐ（無限ループ防止）
- **ストーリーが先、スライドは後**: いきなり Markdown を書かず、S2a で全スライドのアクションタイトルを確定させ、タイトルだけで話が通る（横のロジック）ことを確認してから本文化する
- **デザインの既定は `templates/presentation-starter.md`**: ユーザーが別のデザインリファレンスを指定していない限り、これを土台にする。
- **品質の見本は `templates/examples/gold-standard-proposal.md`**: S2b で必ず読み、タイトル・密度・マークアップをこの水準に合わせる
- **スタイルはテンプレートが強制する**: 本文側でトークン・定義済みクラス外の色/フォント/inline style を新設しない（reviewer G12 が fail にする）

## S1. Gather（要件収集）

### 入る条件
- タスクが新規
- `.slide-work/request.yaml` が存在しない、または必須項目が欠けている
- reviewer が `missing_info` を返した

### 行うこと
1. `.slide-work/` ディレクトリを作成する
2. `templates/request-template.yaml` をコピーして `.slide-work/request.yaml` を作る
3. ユーザーとの会話で必須項目を埋める:
   - `topic`, `audience`, `audience_knowledge`, `presentation_context`
   - `presentation_type`（`proposal`, `report`, `training`, `executive-update`, `research` のいずれかに正規化）
   - `goal`, `target_slide_count`, `output_formats`
   - `must_include`, `source_materials`（あれば）
   - `design_reference`（任意）: 既存デッキのデザインを踏襲したい場合、その Marp ファイルのパス。未指定なら既定の `templates/presentation-starter.md` を使う
4. `references/presentation-structures.md` を見て、`presentation_type` に合った構成パターンを提示し、大まかな流れ（章立て）をユーザーと合意する

### 正規化と既定値

- `presentation_type` は目的から選ぶ:
  - 承認・予算・導入判断を求める → `proposal`
  - 進捗・結果・分析報告 → `report`
  - 経営層向けの現状共有と判断要求 → `executive-update`
  - 学習・手順習得 → `training`
  - 調査結果・仮説検証 → `research`
- 優先順位: 承認・予算・導入・PoC 可否が主目的なら、聞き手が経営層でも `proposal` を選ぶ。`executive-update` は主目的が現状共有・進捗報告で、その一部として判断を求める場合に使う
- `target_slide_count` は「7枚くらい」などの自然表現から整数化する。範囲指定なら中央値を使い、未指定なら `presentation_type` に合う 7 枚を既定にする
- `output_formats` はユーザーが指定した形式を小文字配列にする。未指定なら `["pdf"]`
- `audience_knowledge` が未指定なら、聞き手から妥当な前提を置く:
  - 経営層・役員: 業務課題と投資判断は理解、実装詳細は不要
  - 現場部門: 現行業務は理解、技術詳細は最小限
  - 技術者: 実装・制約も理解可能
  - 一般/不明: 前提知識は浅めに置き、専門語は説明する
- `source_materials` がない数値・ROI は実績値を捏造しない。優先順は 1) 計算式 + 空欄、2) 入力欄つきの要確認プレースホルダー、3) 必要な場合だけ明示ラベル付きの仮説レンジ。ユーザーが「おまかせ」と言っている場合はこの優先順で進めてよい。実績値そのものが承認判断の根拠になる場合、またはユーザーが実数精度を求めている場合だけ確認する。プレースホルダーのラベルは「未確認の見積もりである」ことを示す一語でデッキ内を統一し（日本語デッキなら「要確認」、それ以外はデッキの出力言語に合わせる）、仮説レンジを `big-number` など強調 archetype の主数字に置くときは同一スライドに「仮説・要確認」に相当するラベル（デッキ言語）を必ず併置する

### 対話の原則
- 1 回に聞く質問は 2〜3 個まで。大量質問は避ける
- ユーザーの発話から推測できることは推測し、確認だけを求める（「〜ということは、聞き手は○○の前提知識がある方々ですか？」のように仮説確認型）
- 骨格（誰に・何のために・何を判断してもらうか）を先に固め、枚数やフォーマットは後
- 「おまかせ」と言われた部分は妥当なデフォルトを置き、理由を一言添える
- 必須項目と章立てが十分に推測でき、ユーザーが「おまかせ」「進めて」など裁量を明示している場合は、仮定と章立てを短く提示し、ユーザー返信を待たずに S2 に進んでよい。この提示を S1 の「合意」とみなす
- ただし、目的・聞き手・判断要求・必須項目のいずれかが曖昧、または数値の捏造リスクが高い場合は S2 に進まず確認する

### 抜ける条件
- `request.yaml` の必須項目がすべて埋まっている
- デッキの大まかな章立て（章名のリスト程度）がユーザーと合意できている

## S2. Draft（ドラフト作成）

S2 は 2 段階で進める。**ストーリーボードなしで Markdown を書き始めてはいけない。**

### S2a. ストーリーボード（論理設計）

#### 入る条件
- S1 の抜ける条件を満たした
- `.slide-work/storyboard.md` が存在しない、または要件変更で作り直しが必要

#### 行うこと
1. `references/presentation-structures.md` の「ストーリーボードの作り方」に従い、`.slide-work/storyboard.md` を作成する:
   - ピラミッドを立てる（推奨 1 文 → 論拠 3 個前後 → 支えるデータ）
   - 冒頭 2 枚を SCQA で設計する
   - 全スライドのアクションタイトルを確定文で書き切る
   - タイトルだけを通読して話が通るか（横のロジック）を自己検証する
   - 各スライドに archetype を割り当てる（`references/layout-patterns.md`）
2. アクションタイトルの基準: スライドの結論を述べる完全な文・40 全角字以内・2 行以内・能動態・可能なら定量。「および」「かつ」で 2 主張をつなぐくらいなら 2 枚に分ける

   | 悪い例 | 良い例 |
   |---|---|
   | 在庫管理の現状について | 滞留在庫のコストは年間4,200万円に達している |
   | 導入スケジュール | 2026年度内に全社展開まで到達できる |

3. ユーザー合意は S1 の裁量ルールに従う: 「おまかせ」等の裁量が明示されていればストーリーボードの要点（タイトル一覧）を短く提示して S2b に進んでよい。判断要求や must_include の解釈が曖昧なら確認する

#### 抜ける条件
- `storyboard.md` が完成し、タイトルの通読で主張が一本のストーリーとして通っている

### S2b. ドラフト（Markdown 化）

#### 入る条件
- `.slide-work/storyboard.md` が存在する

#### 行うこと
1. デザインの土台を選ぶ: `request.yaml.design_reference` が指定されていればそのファイル、未指定なら `templates/presentation-starter.md`。**style ブロックは未使用クラスも含めて丸ごと `slides/presentation.md` に転記し、使う archetype だけに削らない**（クラス欠落による表示崩れを防ぐ）
2. `templates/examples/gold-standard-proposal.md` を読み、タイトルの書き方・密度感・マークアップ構造の水準を確認する。ドラフトはこの見本と同じ構造規約で書く
3. アセットをコピーする: テンプレートが `assets/` 配下の画像（ロゴ等）を参照している場合、テンプレートと同じディレクトリの `assets/` を `slides/assets/` にコピーする。Markdown 内の参照は `assets/...` のままでよい（`slides/presentation.md` からの相対パスで解決される）。既定の presentation-starter は画像を使わないためコピー不要
4. storyboard の各行を、割り当てた archetype の見本マークアップ（`references/layout-patterns.md` のスニペット、完全版はテンプレート本文）どおりに実装する。ルール:
   - タイトルは storyboard で確定したアクションタイトルをそのまま使う（`section-divider` の見出しは章ラベルでよく、この規則の対象外）
   - 2 枚目に executive summary を置き、最後に next action を置く
   - 7 枚以上のデッキには少なくとも 1 枚の `section-divider` を入れる。15 枚以上では章ごとに入れる
   - 1 スライド 1 メッセージ、1 リストブロックにつき bullet 3 つ以下、タイトル除くテキスト 6 行以下
   - 同一 archetype が 3 枚連続しないように並べる
   - `request.yaml.must_include` の全項目を盛り込む
   - 構成パターンの枚数が `target_slide_count` と違うときは target ±3 枚に収める: 多い場合は低優先の要素（背景・詳細）から圧縮し、少ない場合は中核要素を章に分割して `section-divider` で区切る（タイトル・エグゼクティブサマリー・next action は必ず残す）
   - ユーザーの言語で書く（テンプレートが英語でも、日本語依頼なら日本語で）
   - デザイントークン規律を守る: 色・フォント・サイズはテンプレートの CSS 変数と定義済みクラスだけ。inline style・新しい色コード・未定義クラス・`<style>` ブロックを本文に書かない
5. セルフチェックを 1 回だけ行う（Self-Refine）:
   - `bash "${CLAUDE_PLUGIN_ROOT}/scripts/deck-lint.sh" --source slides/presentation.md --target <target_slide_count>` を実行し、FAIL をすべて修正する（WARN は内容を見て判断）。プラグインパスが不明な場合はこのスキルからの相対で `../../scripts/deck-lint.sh` を使う
   - `../../agents/reviewer.md` の 12 ゲートを基準に自分の目で一度だけ批評し、直せる欠陥（言い換え bullet、密度超過、単調な並び）を直す
   - **このセルフチェックは reviewer の代替ではない**。`review.json` を書いたり pass を名乗ったりしてはいけない

#### 抜ける条件
- `slides/presentation.md` が存在し、deck-lint の FAIL が 0 件でレビュー可能な状態になっている

## S3. Review（批判的レビュー）

### 入る条件
- `slides/presentation.md` が存在する、または直近で変更された
- `.slide-work/review.json` が存在しない、または status != "pass"
- `review.json.status == "pass"` でも `source_sha256` が現在の `slides/presentation.md` と一致しない

### 行うこと
1. **`review_attempt` を加算する**: reviewer を実際に呼び出すたびに `review_attempt` を 1 増やす責任は main agent にある。直前の `.slide-work/review.json.review_attempt`（無ければ 0）に +1 した値 `N` を求める。加算主体を main agent の一点に固定し、off-by-one や二重カウントを避ける。reviewer を呼ばない S3 再入（missing_info の確認待ち、infra_blocked からの環境復旧、reviewer 不可で判定が出ない場合）では加算しない
2. **reviewer サブエージェントを呼び出す**:
   - Agent ツールで `subagent_type: reviewer` を指定し、**呼び出しプロンプトに「今回は review_attempt = N」と明示して渡す**。reviewer はこの値を `review.json.review_attempt` にそのまま記録する
   - reviewer は別コンテキストで `slides/presentation.md` と `request.yaml` を読み、生バイト SHA-256 で `source_sha256` を記録し、MCP で PDF/PNG を出力し、PNG を目視し、12 ゲートで判定して `.slide-work/review.json` を書き込む
   - 詳細は `../../agents/reviewer.md` を参照
3. **`review.json.status` を確認する**:
   - `pass` → 現在の `slides/presentation.md` の生バイト SHA-256 と `review.json.source_sha256` の一致を確認して S4 へ（計算方法は「ツール境界」参照。大文字小文字は無視。**暗算・捏造しない**）
   - `missing_info` → `questions_for_user` をユーザーに確認し、`request.yaml` を更新、S3 を再実行
   - `fail` → `exact_fix_instructions` に従って `slides/presentation.md` を修正、S3 を再実行
   - `infra_blocked` → 環境起因の停止。デッキは直さない。`issues` の原因（Docker 未起動など）をユーザーに案内し、環境が整ってから S3 を再実行する。Stop hook はこの状態（`source_sha256` 一致）での停止を許可する。既に `infra_blocked` が記録され reviewer も起動できない場合は infra_blocked の案内を優先し、別途 `review-blocked.json` は書かない

### fail の消費ルール

- `exact_fix_instructions` は上から順にすべて適用する。勝手に選別しない
- 修正は 1 回の revision pass にまとめ、`slides/presentation.md` 以外を変更しない
- 指示が空、曖昧、矛盾、または適用不能な場合は、同じ reviewer を再利用せず S3 を再実行する（この再実行も `review_attempt` を 1 消費する）。再実行後も malformed なら、問題のある指示を具体的に示してユーザーに判断を仰ぐ
- `slides/presentation.md` を変更した時点で古い pass は無効になる。次の reviewer が新しい `source_sha256` を記録するまで S4 に進まない
- reviewer サブエージェントを起動できない環境で既存の `exact_fix_instructions` がある場合は、具体的な指示だけを適用してから `.slide-work/review-blocked.json` を書いて停止する。新しい判定・pass・`review.json` 更新は行わない

### reviewer 不可時の停止マーカー

`reviewer` サブエージェントを起動できず正当に停止する場合、main agent は `.slide-work/review-blocked.json` を書く:

```json
{
  "status": "blocked",
  "reason": "reviewer_unavailable",
  "source_sha256": "sha256-of-current-slides/presentation.md",
  "message": "reviewer サブエージェントを起動できないため、完了ゲートを通せません。"
}
```

- `source_sha256` は停止時点の `slides/presentation.md` の生バイト SHA-256（計算方法は「ツール境界」参照。暗算・捏造しない）。修正を適用した場合は適用後の SHA-256 を入れる（編集で旧ハッシュは無効になるため）。ハッシュ計算はローカルで完結するので通常は取得できるが、万一取得できない場合は `source_sha256` を null にし `message` に理由を書く（Stop hook はこの marker では停止を許可しないので、ユーザーに手動確認を促す）
- これは未完了マーカーであり、pass ではない。次回再開時は S3 から続ける
- 予備セルフチェックは、適用済みの `exact_fix_instructions` の確認だけに限定する。gate verdict、pass/fail 判定、`review.json` 更新、完了報告は行わない

### 再試行上限
- S3 の fail → 修正 → S3 再実行 のループは **最大 3 回**。判定は単一述語で行う: **`review_attempt >= 3` かつ直近 status が `fail` なら、自動修正を止めてユーザーに相談する**。fail 消費ルールはこの上限に従属し、上限到達時は再修正より相談を優先する
- カウントは `review_attempt` の一本だけを使う。malformed 指示による再実行（上記）も 1 attempt として消費する。別カウントを作らない
- `infra_blocked`（環境起因）は品質 fail の 3 回上限には数えない。環境を直して再実行する
- 直近の `.slide-work/review.json.review_attempt` を確認し、3 回目の fail 後は自動修正を続けない
- 3 回連続で fail になったら、`review.json` の内容をユーザーに共有し、方針の判断を仰ぐ（要件の見直しか、デザインの妥協か、など）

### 抜ける条件
- `review.json.status == "pass"` かつ `review.json.source_sha256` が現在の `slides/presentation.md` の SHA-256 と一致している

## S4. Export & Approve（最終確認）

### 入る条件
- `review.json.status == "pass"` かつ `review.json.source_sha256` が現在の `slides/presentation.md` の SHA-256 と一致している

### 行うこと
1. `slides/presentation.md` の生バイト SHA-256 と `review.json.source_sha256` が一致することを確認する（計算方法は「ツール境界」参照。大文字小文字は無視。暗算・捏造しない）。不一致・欠落・取得不能なら S3 に戻る
2. `review.json.artifacts.pdf` と `page_images` のパスを確認する（既に S3 で reviewer が出力済み）
3. ユーザーに完了を報告する:
   - PDF のパス: `.slide-work/presentation.pdf`
   - スライド枚数
   - 主な takeaway（章立て）
4. 追加で HTML や PPTX が要求されている場合（`request.yaml.output_formats`）は、MCP `marp_export` で追加出力する
5. ユーザーの承認を待つ

### 抜ける条件
- ユーザーが完成を承認した

## 中断・再開時の判定

会話が途中で切れた場合や別の会話で作業を再開するときは、`.slide-work/` の状態から現在の状態を判定する:

| 条件 | 入る状態 |
|------|----------|
| `.slide-work/` が存在しない、または `request.yaml` の必須項目が不足 | S1 |
| `request.yaml` は埋まっているが `storyboard.md` も `slides/presentation.md` も存在しない | S2a |
| `storyboard.md` はあるが `slides/presentation.md` が存在しない | S2b |
| `slides/presentation.md` が存在するが `review.json.status != "pass"` | S3 |
| `review.json.status == "pass"` だが `review.json.source_sha256` が欠落、または現在の `slides/presentation.md` の SHA-256 と一致しない | S3 |
| `review.json.status == "pass"` かつ `source_sha256` が一致しているがユーザー承認がまだ | S4 |
| `review-blocked.json` が現在の `slides/presentation.md` の SHA-256 と一致（reviewer 不可の未完了停止） | 停止を維持しユーザーに reviewer 起動を促す。再開可能になれば S3 |

表は上から評価し、`review-blocked.json` が現在の `slides/presentation.md` の SHA-256 と一致する場合は、それより上の行より優先する。

再開時は「前回の作業を確認しました。現在 S○ の段階です」と一言伝えてから続ける。

## ツール境界

- `marp_export`（MCP）を呼ぶのは **reviewer サブエージェントの中** が基本。main agent も追加フォーマット出力時には呼んでよい。この MCP サーバは **PDF/PPTX/HTML/PNG の出力専用**で、ハッシュ計算は持たない
- **SHA-256 はホスト側で計算する**（PDF/PPTX を出力する MCP サーバとは別の場所）。生バイト SHA-256 の計算コマンドはこの 3 つのいずれか: `sha256sum`（Linux / Windows Git Bash）／`shasum -a 256`（macOS）／`(Get-FileHash -Algorithm SHA256 <file>).Hash`（Windows PowerShell）。**暗算・捏造しない**。Stop hook のゲート `scripts/review-gate.sh`（bash・Windows/macOS/Linux 対応）も同じ生バイト SHA-256 を計算し大文字小文字を無視して比較するため、書き手と検証側のハッシュは必ず一致する。完了ゲートは Docker/MCP 接続に依存しない
- `scripts/deck-lint.sh` は密度・タイトル長・連続 archetype の**補助チェック専用**。main agent（S2b）と reviewer が実行してよいが、lint は `review.json` を書かず、完了ゲートにも関与しない
- visual review（PNG 目視）は reviewer だけが行う
- main agent は `slides/presentation.md` の作成・修正を行い、`.slide-work/review.json` は読み取り専用。サブエージェント不可時でも main agent が pass を書いてはいけない

## 作業ファイル

- `.slide-work/request.yaml` — 要件
- `.slide-work/storyboard.md` — S2a のストーリーボード（ピラミッド + タイトル一覧 + archetype 割当）
- `.slide-work/review.json` — reviewer の判定結果（source of truth）。`source_sha256` と `review_attempt` を含む
- `.slide-work/review-blocked.json` — reviewer 不可で正当に停止した未完了マーカー
- `.slide-work/presentation.pdf` — PDF 出力
- `.slide-work/rendered-pages/page-###.png` — ページ画像
- `slides/presentation.md` — Marp ソース（最終成果物の本体）
- `slides/assets/` — テンプレート由来の画像アセット

## 参照

- `../../agents/reviewer.md` — reviewer サブエージェントの仕様（12 ゲートの詳細はここ）
- `../../scripts/review-gate.sh` — ホスト側の完了ゲート / ハッシュ計算（Stop hook が呼ぶ。export MCP から独立）
- `../../scripts/deck-lint.sh` — 決定論的な密度・タイトル・連続 archetype リント（S2b セルフチェック用）
- `templates/request-template.yaml` — request state の初期値
- `templates/review-template.json` — review state の初期値
- `templates/presentation-starter.md` — 既定のデザインリファレンス（デザイントークン + 13 archetype + 部品・ピクトグラム CSS + マークアップ見本）
- `templates/examples/gold-standard-proposal.md` — 完成品質の見本デッキ（S2b で必読）
- `references/presentation-structures.md` — 構成パターンとストーリーボードの作り方
- `references/layout-patterns.md` — archetype・部品クラスとマークアップ規約

## 運用ルール

- 完了条件は `review.json.status == "pass"` かつ `source_sha256` が現在の `slides/presentation.md` と一致すること。他の条件で完了にしてはいけない
- `review.json.status == "pass"` でも、`source_sha256` が現在の `slides/presentation.md` と一致しなければ未レビュー扱いにする
- reviewer が fail を返したら、`exact_fix_instructions` に従って修正する。指示を読まずに stop してはいけない
- reviewer が missing_info を返したら、`questions_for_user` をユーザーに確認する。推測で先に進めない
- 3 回リトライしても pass しないときは、ユーザーに判断を仰ぐ
- ユーザーが pass 後に内容を変更した場合、古い pass は無効。S3 からやり直す
- `reviewer` サブエージェントが起動できない場合、このスキルは完成まで進めない。main agent は既存 reviewer の具体的な fail 修正、適用済み修正の非権威的セルフチェック、修正案作成までは行ってよいが、完了ゲートを通過したと報告してはいけない
