---
name: main
description: Marp スライドの要件収集、ドラフト作成、批判的レビュー、PDF/PNGエクスポートを行うスキル。レビューは `reviewer` サブエージェントが別コンテキストで実施し、`.slide-work/review.json.status == "pass"` になるまで完了しない。4 状態のワークフロー（Gather → Draft → Review → Export）で進める。
---

# Marp Slide スキル

## 目的

Marp スライドを 4 状態のワークフローで作成する:

1. **S1. Gather** — 要件を会話で収集し `.slide-work/request.yaml` を埋める
2. **S2. Draft** — `slides/presentation.md` を作成する
3. **S3. Review** — `reviewer` サブエージェントが批判的に審査し、必要なら main agent が修正して再実行する（最大 3 回）
4. **S4. Export & Approve** — PDF/PNG を最終確認し、ユーザーに完了報告する

**完了の唯一の条件は `.slide-work/review.json.status == "pass"`** です。他の条件で完了扱いにしてはいけません。

## 重要な設計原則

- **レビューは別 AI が行う**: ドラフトを作った main agent ではなく、`reviewer` サブエージェントが判定します。Claude Code の Agent ツールで `subagent_type: reviewer` を指定して呼び出します
- **ゲートは 10 個だけ**: reviewer は 10 個のハードゲート（ストーリー 5 + ビジュアル 5）だけを見ます。詳細は `../../agents/reviewer.md`
- **修正ループは最大 3 回**: S3 で 3 回連続 fail ならユーザーに相談して判断を仰ぐ（無限ループ防止）
- **デザインの既定は `templates/presentation-starter.md`**: ユーザーが別のデザインリファレンスを指定していない限り、これを土台にする

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
4. `references/presentation-structures.md` を見て、`presentation_type` に合った構成パターンを提示し、大まかな流れ（章立て）をユーザーと合意する

### 対話の原則
- 1 回に聞く質問は 2〜3 個まで。大量質問は避ける
- ユーザーの発話から推測できることは推測し、確認だけを求める（「〜ということは、聞き手は○○の前提知識がある方々ですか？」のように仮説確認型）
- 骨格（誰に・何のために・何を判断してもらうか）を先に固め、枚数やフォーマットは後
- 「おまかせ」と言われた部分は妥当なデフォルトを置き、理由を一言添える

### 抜ける条件
- `request.yaml` の必須項目がすべて埋まっている
- デッキの大まかな章立て（章名のリスト程度）がユーザーと合意できている

## S2. Draft（ドラフト作成）

### 入る条件
- S1 の抜ける条件を満たした

### 行うこと
1. `templates/presentation-starter.md` を土台として `slides/presentation.md` を作成する
2. `references/layout-patterns.md` を参照し、各スライドに適した archetype を選ぶ
3. 以下のルールを守る:
   - タイトルは topic label ではなく takeaway（結論）を断定的に書く
   - 2 枚目に executive summary を置き、最後に next action を置く
   - 7 枚以上のデッキには少なくとも 1 枚の `section-divider` を入れる
   - 1 スライド 1 メッセージ、タイトル除くテキスト 6 行以下、bullet 3 つ以下
   - 同一 archetype が 3 枚連続しないように並べる
   - `request.yaml.must_include` の全項目を盛り込む
   - ユーザーの言語で書く（テンプレートが英語でも、日本語依頼なら日本語で）

### 抜ける条件
- `slides/presentation.md` がレビュー可能な状態になっている

## S3. Review（批判的レビュー）

### 入る条件
- `slides/presentation.md` が存在する、または直近で変更された
- `.slide-work/review.json` が存在しない、または status != "pass"

### 行うこと
1. **reviewer サブエージェントを呼び出す**:
   - Agent ツールで `subagent_type: reviewer` を指定
   - reviewer は別コンテキストで `slides/presentation.md` と `request.yaml` を読み、MCP で PDF/PNG を出力し、PNG を目視し、10 ゲートで判定して `.slide-work/review.json` を書き込む
   - 詳細は `../../agents/reviewer.md` を参照
2. **`review.json.status` を確認する**:
   - `pass` → S4 へ
   - `missing_info` → `questions_for_user` をユーザーに確認し、`request.yaml` を更新、S3 を再実行
   - `fail` → `exact_fix_instructions` に従って `slides/presentation.md` を修正、S3 を再実行

### 再試行上限
- S3 の fail → 修正 → S3 再実行 のループは **最大 3 回**
- 3 回連続で fail になったら、`review.json` の内容をユーザーに共有し、方針の判断を仰ぐ（要件の見直しか、デザインの妥協か、など）

### 抜ける条件
- `review.json.status == "pass"`

## S4. Export & Approve（最終確認）

### 入る条件
- `review.json.status == "pass"`

### 行うこと
1. `review.json.artifacts.pdf` と `page_images` のパスを確認する（既に S3 で reviewer が出力済み）
2. ユーザーに完了を報告する:
   - PDF のパス: `.slide-work/presentation.pdf`
   - スライド枚数
   - 主な takeaway（章立て）
3. 追加で HTML や PPTX が要求されている場合（`request.yaml.output_formats`）は、MCP `marp_export` で追加出力する
4. ユーザーの承認を待つ

### 抜ける条件
- ユーザーが完成を承認した

## 中断・再開時の判定

会話が途中で切れた場合や別の会話で作業を再開するときは、`.slide-work/` の状態から現在の状態を判定する:

| 条件 | 入る状態 |
|------|----------|
| `.slide-work/` が存在しない、または `request.yaml` の必須項目が不足 | S1 |
| `request.yaml` 埋まっているが `slides/presentation.md` が存在しない | S2 |
| `slides/presentation.md` が存在するが `review.json.status != "pass"` | S3 |
| `review.json.status == "pass"` だがユーザー承認がまだ | S4 |

再開時は「前回の作業を確認しました。現在 S○ の段階です」と一言伝えてから続ける。

## ツール境界

- `marp_export`（MCP）を呼ぶのは **reviewer サブエージェントの中** が基本。main agent も追加フォーマット出力時には呼んでよい
- visual review（PNG 目視）は reviewer だけが行う
- main agent は `slides/presentation.md` の作成・修正を行い、`.slide-work/review.json` は読み取り専用

## 作業ファイル

- `.slide-work/request.yaml` — 要件
- `.slide-work/review.json` — reviewer の判定結果（source of truth）
- `.slide-work/presentation.pdf` — PDF 出力
- `.slide-work/rendered-pages/page-###.png` — ページ画像
- `slides/presentation.md` — Marp ソース（最終成果物の本体）

## 参照

- `../../agents/reviewer.md` — reviewer サブエージェントの仕様（10 ゲートの詳細はここ）
- `templates/request-template.yaml` — request state の初期値
- `templates/review-template.json` — review state の初期値
- `templates/presentation-starter.md` — 既定のデザインリファレンス（visual language の土台）
- `references/presentation-structures.md` — `presentation_type` ごとの構成パターン
- `references/layout-patterns.md` — archetype ごとのレイアウト指針

## 運用ルール

- 完了条件は `review.json.status == "pass"` の 1 つだけ。他の条件で完了にしてはいけない
- reviewer が fail を返したら、`exact_fix_instructions` に従って修正する。指示を読まずに stop してはいけない
- reviewer が missing_info を返したら、`questions_for_user` をユーザーに確認する。推測で先に進めない
- 3 回リトライしても pass しないときは、ユーザーに判断を仰ぐ
- ユーザーが pass 後に内容を変更した場合、古い pass は無効。S3 からやり直す
- 本スキルはシングルエージェント環境でも動作する: サブエージェントが起動できない場合、main agent が `../../agents/reviewer.md` を読み、その手順を自分で実行する（ただし批判的な視点に切り替えること）
