---
name: marp-slide
description: Marp スライドの要件整理、デザインシステム設計、スライド計画、作成、レビュー、エクスポートにはこのスキルを使ってください。`.slide-work/design-system.yaml` と `.slide-work/slide-plan.yaml` を先に作り、スライド画像を使った visual review と quality rubric が pass になるまで完了してはいけません。
---

# Marp Slide スキル

## 目的

このスキルは、Marp の作業を状態機械として進めるために使います:

1. 要件を収集する（ユーザーとの対話）
2. 構成コンサルタントで要件を分析する
3. アウトラインを提案する（ユーザーの承認）
4. `.slide-work/design-system.yaml` を作る
5. `.slide-work/slide-plan.yaml` を作る
6. `slides/presentation.md` を作成する
7. レビューする
8. pass になるまで修正と再レビューを繰り返す
9. review gate を満たした後にのみ完了する

良いデザインの source of truth は `.slide-work/design-system.yaml` と `.slide-work/slide-plan.yaml` です。
完了判定の source of truth は、常に最新の `.slide-work/review.json` です。
口調、経過時間、あるいは「たぶん十分よさそう」といった推測で完了を判断してはいけません。

## ツール境界

- `marp` MCP サーバーが扱うのは `marp_export` だけです
- Visual review は MCP の責務ではありません
- Visual review では `.slide-work/rendered-pages/page-###.png` を確認しなければなりません
- reviewer は `.slide-work/design-system.yaml` と `.slide-work/slide-plan.yaml` を読み、そこに沿っているかも判定しなければなりません
- reviewer は判定と `.slide-work/review.json` の書き換えだけを行い、スライド修正は行いません

## 作業ファイル

主なファイル:

- `.slide-work/request.yaml`
- `.slide-work/outline.yaml`
- `.slide-work/design-system.yaml`
- `.slide-work/slide-plan.yaml`
- `.slide-work/review.json`
- `.slide-work/preview.html`
- `.slide-work/presentation.pdf`
- `.slide-work/presentation.pptx`
- `.slide-work/rendered-pages/page-###.png`
- `slides/presentation.md`

補助ファイル:

- `templates/request-template.yaml`
- `templates/outline-template.yaml`
- `templates/design-system-template.yaml`
- `templates/slide-plan-template.yaml`
- `templates/review-template.json`
- `templates/presentation-starter.md`
- `references/presentation-structures.md`
- `references/layout-patterns.md`
- `references/design-reference-playbook.md`

## 既定デザイン参照

ユーザーが別の design reference を明示していない場合は、`templates/presentation-starter.md` を既定デザイン参照として扱ってください。
このときは次を行ってください:

- `templates/presentation-starter.md` の frontmatter、style block、header/footer、pagination、class 語彙を先に読む
- 色、余白、カード、グリッド、section-divider、title-hero などの visual language を継承する
- プレースホルダーの文言は流用せず、見た目と構成語彙だけを再利用する

## 対話の原則

ユーザーの依頼をそのまま必須項目の穴埋めに変換しない。ユーザーの頭の中にある文脈、意図、制約を引き出すことが目的であり、フォームを埋めることが目的ではない。

- **1 回に聞く質問は 2〜3 個まで**にする。大量の質問を一度に投げるとユーザーの負担が大きく、回答の質も下がる
- **ユーザーの回答から推測できることは推測し、確認だけ求める**。「〜ということは、聞き手は○○の前提知識がある方々ですか？」のように仮説を提示して Yes/No で答えられる形にすると負担が少ない
- **重要度の高い情報から順に聞く**。資料の骨格に関わる情報（誰に・何のために・何を判断してもらうか）を先に固め、枚数やフォーマットの詳細は後でよい
- **ユーザーが「おまかせ」と言った部分は妥当なデフォルトを選んで進める**。ただし選んだ理由を一言添えて、後から変更できることを伝える

## 必須のリクエスト項目

`.slide-work/request.yaml` では次の項目を必須として扱います:

- `topic`
- `audience`
- `audience_knowledge`
- `presentation_context`
- `presentation_type`
- `goal`
- `target_slide_count`
- `output_formats`

いずれかの必須項目が空、null、または実質的に欠落している場合、そのタスクは `missing_info` 状態にあり、推測で先へ進めてはいけません。
`presentation_type` は少なくとも次のどれかに正規化してください:

- `proposal`
- `report`
- `training`
- `executive-update`
- `research`

## 状態機械

### S0. 初期化

1. `.slide-work/` を作成する
2. `templates/request-template.yaml` から `.slide-work/request.yaml` を初期化する
3. `templates/outline-template.yaml` から `.slide-work/outline.yaml` を初期化する
4. `templates/design-system-template.yaml` から `.slide-work/design-system.yaml` を初期化する
5. `templates/slide-plan-template.yaml` から `.slide-work/slide-plan.yaml` を初期化する
6. `templates/review-template.json` から `.slide-work/review.json` を初期化する

### S1. 要件収集

次の場合に入る:

- タスクが新規である
- 必須の request 項目が不足している
- reviewer が `missing_info` を返した

#### 対話の進め方

ユーザーの最初の依頼から読み取れる情報をまず `request.yaml` に埋め、残りの不足を段階的に聞く。以下の順序を目安にする:

**ラウンド 1: 骨格を掴む**

ユーザーの依頼文から `topic` と大まかな状況はわかることが多い。まだわからない場合は、まずここを聞く:

- この資料で **誰に** 何を伝えたいですか？（`audience`）
- その人たちに **どうなってほしい**ですか？ 判断、理解、行動など（`goal`）

この 2 つがわかれば `presentation_type` はほぼ推測できる。推測して「○○型の資料でよいですか？」と確認する。

**ラウンド 2: 聞き手の解像度を上げる**

骨格が固まったら、聞き手の理解を深める:

- 聞き手はこのトピックについて **どの程度知っていますか？**（`audience_knowledge`）
- この資料が使われる **場面** はどういう状況ですか？ 会議、メール送付、研修など（`presentation_context`）

ここでの回答は、後のアウトラインの深さや説明の粒度を決める材料になる。

**ラウンド 3: 制約と素材を確認する**

- 枚数の希望はありますか？（`target_slide_count`）。なければ内容に応じて提案する
- 出力形式の希望はありますか？（`output_formats`）。なければ PDF をデフォルトにする
- 必ず入れてほしい内容やデータはありますか？（`must_include`、`source_materials`）

#### 暗黙の前提を掘り起こす

必須項目が埋まっても、アウトラインの質を左右する暗黙の情報が残っていることがある。以下のような観点で、ユーザーが言っていないが重要な情報がないか考える:

- 聞き手が **すでに知っていること** と **まだ知らないこと** の境界はどこか
- この資料の **前後の文脈** は何か（前回の会議で何が議論された、次に何が予定されている等）
- 聞き手が **懸念しそうなこと** や **反対しそうなポイント** はあるか
- **使ってはいけない表現** や **触れてはいけないトピック** はあるか

これらすべてを毎回聞くのではなく、依頼の内容から「ここが曖昧だと構成に影響する」と判断したものだけを 1〜2 個ずつ確認する。

#### request.yaml の更新

対話で得た情報は都度 `request.yaml` に反映する。`missing_required` と `open_questions` を最新に保つ。

次の場合に抜ける:

- 必須項目がすべて埋まっている
- アウトラインの構成に影響する重要な曖昧さが残っていない

### S2. 構成コンサルタントによる分析

S1 で必須項目が埋まったら、アウトラインを自分で作成する前に `../../agents/structure-consultant.md` を使って構成コンサルタントを呼び出す。

構成コンサルタントは `request.yaml` を読み、以下を分析して返す:

- 要件の実質的な完全性（形式的に埋まっていても曖昧な項目がないか）
- ユーザーが明示していない暗黙の前提（知識ギャップ、文脈の断絶、想定される反論）
- 推奨ストーリーアークと代替案
- ユーザーに確認すべき質問（優先度付き）

#### 分析結果の使い方

- **必須の確認事項**がある場合: S1 に戻り、コンサルタントが提案した質問をユーザーに確認する。一度に全部聞かず、1〜2 問ずつ小分けにする
- **必須の確認事項がない場合**: コンサルタントの推奨ストーリーアークを S3 のアウトライン作成の土台に使う。推奨の確認事項があれば、アウトライン提示時に合わせて確認する

コンサルタントの提案はあくまで分析材料であり、そのまま採用する義務はない。メインエージェントとして判断し、必要に応じて調整する。

### S3. アウトライン提案

次の場合に入る:

- `request.yaml` に必須項目がすべて入っている
- S2 の構成コンサルタントによる分析が完了している

#### アウトライン作成

- S2 で得たストーリーアークの提案を土台にする
- `references/presentation-structures.md` を参照し、`presentation_type` に合った構成パターンと照合する
- 2 枚目を executive summary、最後を next action に寄せる
- 各スライドの `title` は topic label ではなく、聞き手が持ち帰る結論（takeaway）を断定的に書く

#### ユーザーへの提示

アウトラインを作成したら、以下をセットでユーザーに見せる:

1. **構成の意図**: なぜこの順序にしたのか、どういうストーリーで聞き手を導くのかを 2〜3 文で説明する
2. **各スライドの役割**: スライドごとのタイトル案と、そのスライドがデッキの中で果たす役割を簡潔に示す
3. **確認ポイント**: 「この流れで聞き手の○○という疑問に答えられるか」「△△のデータは入れるべきか」など、構成の判断に関わる具体的な問いを 1〜2 個添える。S2 の「推奨の確認事項」がまだ残っていれば、ここで合わせて聞く

「このアウトラインでいいですか？」とだけ聞くのではなく、ユーザーが判断しやすい材料を提供する。

#### 修正の反復

ユーザーから修正の要望があれば、アウトラインを更新して再提示する。大幅な方向転換の場合は、再度構成コンサルタントを呼んで代替案を検討してもよい。ユーザーが承認するまでこのループを繰り返す。アウトライン承認前にスライド本文を作成してはいけない。

次の場合に抜ける:

- ユーザーがアウトラインを承認し、`request.yaml.approval.outline_approved` を `true` にできる

### S4. デザインシステム設計

次の場合に入る:

- `approval.outline_approved == true`

行うこと:

- `templates/design-system-template.yaml` を使って `.slide-work/design-system.yaml` を埋める
- `request.yaml.design_reference` が指定されていない場合は、`templates/presentation-starter.md` を先に読んで visual language を抽出する
- `presentation_type`、読者、目的、デザイン参照をもとに deck style、typography、layout、visual、consistency、Marp policy を定義する
- `references/design-reference-playbook.md` を使って既存デッキや PPTX の方向性を再現する
- untouched default Marp styling のまま提出しない方針を明示する

次の場合に抜ける:

- `.slide-work/design-system.yaml` が実質的に埋まっている

### S5. スライド計画

次の場合に入る:

- `.slide-work/design-system.yaml` が埋まっている

行うこと:

- `templates/slide-plan-template.yaml` を使って `.slide-work/slide-plan.yaml` を作成する
- 各スライドに `role`、`takeaway`、`archetype`、`key_visual`、`max_text_lines`、`max_bullets` を定義する
- `references/layout-patterns.md` の承認済み archetype から選ぶ
- 目次なら `agenda-overview`、標準的な説明ページなら `title-content`、左右に2つの内容を並べるなら `two-column-content` を優先候補にする
- 1 枚目は `title-hero`、2 枚目は executive summary、最後は `closing-next-action` を基本とする
- 7 枚以上のデッキでは、少なくとも 1 枚の `section-divider` を入れる
- 箇条書きだけのスライドが 30% を超えそうなら、この段階で構成を組み直す
- 同一 archetype が 40% を超えそうなら、この段階で構成を組み直す

次の場合に抜ける:

- `.slide-work/slide-plan.yaml` が outline と design system の両方に整合している

### S6. ドラフト作成

次の場合に入る:

- `approval.outline_approved == true`
- `.slide-work/design-system.yaml` が存在する
- `.slide-work/slide-plan.yaml` が存在する

行うこと:

- `slides/presentation.md` を作成または更新する
- `request.yaml` の `must_include` と `source_materials` を読み、指定された内容やデータを必ず盛り込む
- `templates/presentation-starter.md` をベースとして使う
- `design_reference` が空なら、`templates/presentation-starter.md` の frontmatter と class vocabulary を優先して継承する
- `references/layout-patterns.md` と `references/design-reference-playbook.md` を補助として使う
- slide plan の archetype を、そのまま Marp 実装に落とし込む
- スライド本文はユーザーの言語で書く（テンプレートが英語でも、ユーザーが日本語で依頼していれば日本語で書く）
- 1 スライド 1 メッセージと低い情報密度を守る
- タイトルはトピック名ではなく takeaway を断定的に書く
- bullet はタイトルの補強だけに使い、タイトルの言い換えを並べない
- 重要な数字や結論だけを視覚的に強調する
- global directives で theme、paginate、header、footer を整え、local class directives で archetype を切り替える
- background image はメッセージを強める場合にだけ使い、飾り目的では使わない
- split background は `section-divider` または比較スライドに限って使う

次の場合に抜ける:

- `slides/presentation.md` が存在し、レビュー可能な状態になっている

### S7. レビュー必須

次の場合に入る:

- `slides/presentation.md` が作成された
- `slides/presentation.md`、`.slide-work/request.yaml`、`.slide-work/outline.yaml`、`.slide-work/design-system.yaml`、または `.slide-work/slide-plan.yaml` が変更された
- 既存の review が欠けている、stale である、不完全である、または visual review を欠いている

行うこと:

- hook による reviewer 再実行に依存する
- hook が動かなかった場合、または freshness を証明できない場合は、`../../agents/slide-reviewer.md` を使って reviewer を手動で再実行する

次の場合に抜ける:

- fresh な `.slide-work/review.json` が存在する

### S8. Review 結果 = `missing_info`

次の場合に入る:

- `.slide-work/review.json.status == "missing_info"`

行うこと:

- `review.json.questions_for_user` にある質問を、そのままユーザーに確認する
- 不足情報を推測してはいけない
- `request.yaml` または `outline.yaml` を更新する
- 必要なら `design-system.yaml` を更新する
- S7 に戻る

### S9. Review 結果 = `fail`

次の場合に入る:

- `.slide-work/review.json.status == "fail"`

行うこと:

- `review.json.exact_fix_instructions` を読む
- その修正を作業ファイルへ適用する
- 必要なら `design-system.yaml` または `slide-plan.yaml` に戻って設計をやり直す
- その指示が未解決のまま stop してはいけない
- 編集後に S7 へ戻る

### S10. Review 結果 = `pass`

次の場合に入る:

- `.slide-work/review.json.status == "pass"`

すぐに完了してはいけません。`review.json` の内容を「完了条件」セクションの全項目に照らして確認してください。
いずれか 1 つでも欠けていれば S9 と同じように修正し、S7 に戻ってください。

完了条件をすべて満たしたら、最終成果物（PDF のパス、スライド枚数、主な内容）をユーザーに提示し、完了の確認を取る。ユーザーが承認したら `request.yaml.approval.draft_approved` を `true` にする。

ユーザーまたはメイン agent が pass 後に内容を変更した場合、古い pass は無視して S7 に戻ってください。`draft_approved` も `false` にリセットしてください。

## 中断・再開時の判定

会話が途中で切れた場合や、別の会話で作業を再開する場合は、`.slide-work/` の状態から現在のステップを判定する:

| 条件 | 入るステップ |
|------|-------------|
| `.slide-work/` が存在しない | S0 |
| `request.yaml` の必須項目が不足している | S1 |
| `outline.yaml` が空、または `approval.outline_approved != true` | S2 または S3 |
| `design-system.yaml` が実質的に空 | S4 |
| `slide-plan.yaml` が実質的に空 | S5 |
| `slides/presentation.md` が存在しない | S6 |
| `review.json` が存在しない、stale、または `status != "pass"` | S7 |
| `review.json.status == "missing_info"` | S8 |
| `review.json.status == "fail"` | S9 |
| `review.json.status == "pass"` かつ完了条件をすべて満たす | S10（完了）|

上から順に評価し、最初に該当した行のステップに入る。再開時にユーザーへ「前回の作業を確認しました。現在○○の段階です」と一言伝えてから作業を続ける。

## デザインシステム規律

`.slide-work/design-system.yaml` では少なくとも次を決めてください:

- `deck_style.presentation_type`
- `deck_style.tone`
- `deck_style.visual_style`
- `deck_style.theme_name`
- `typography.title_max_chars`
- `typography.body_max_bullets`
- `typography.body_max_lines_per_bullet`
- `layout_rules.approved_archetypes`
- `layout_rules.max_same_archetype_ratio`
- `visual_rules.use_background_images`
- `visual_rules.use_split_background`
- `consistency_rules.section_divider_required`
- `marp_policy.use_custom_theme_foundation`

このファイルが空欄だらけ、または deck の実装と明らかに整合しない場合は、ドラフトを直す前に design system を修正してください。

## スライド計画規律

`.slide-work/slide-plan.yaml` では、各スライドが勝つ理由を本文より先に決めます。
各スライドは最低限、次を持たなければなりません:

- `role`
- `takeaway`
- `archetype`
- `key_visual`
- `max_text_lines`

slide plan に archetype が書かれていないスライドを作ってはいけません。

## 執筆ルール

- すべてのスライドタイトルはトピックではなく takeaway を書く
- assertion-style heading を優先する
- bullet はタイトルを補強し、タイトルの言い換えを繰り返さない
- 重要な数字、差分、判断ポイントだけを太字または強い視覚要素で目立たせる
- 箇条書きだけで押し切るのではなく、archetype に合う構図へ分解する
- アイコンを使うなら line / outline icon を優先し、装飾ではなくスキャン補助として使う
- 説明的な長文段落は避ける

## Marp 実装ポリシー

- custom theme foundation を deck の土台として使う
- global directives で `theme`、`paginate`、`header`、`footer` を揃える
- local class directives で archetype ごとの見た目を切り替える
- `title-content` は静かな基準面として扱い、`two-column-content` は2本の読み筋が分かるように panel 差をつける
- split background は `section-divider` または比較スライドに限る
- background images はメッセージを補強するときにだけ使う
- final output を default Marp styling のまま終わらせてはいけない

## Review freshness ルール

次のいずれかが真であれば、その review は stale とみなします:

- `.slide-work/review.json` が存在しない
- `reviewed_at` が存在しない
- `slides/presentation.md` が `reviewed_at` より新しい
- `.slide-work/request.yaml` が `reviewed_at` より新しい
- `.slide-work/outline.yaml` が `reviewed_at` より新しい
- `.slide-work/design-system.yaml` が `reviewed_at` より新しい
- `.slide-work/slide-plan.yaml` が `reviewed_at` より新しい
- `artifacts.pdf` が `.slide-work/presentation.pdf` ではない
- `artifacts.page_images` が空である
- `quality.deck_metrics` が存在しない
- `quality.visual_quality` が存在しない
- `quality.story_quality` が存在しない
- `validation.visual_review.executed != true`
- `validation.visual_review.checked_page_count <= 0`
- `validation.exports.required_formats_satisfied != true`

stale な pass を完了根拠に使ってはいけません。

## Reviewer 契約

reviewer の仕様と品質ルブリックの source of truth は `../../agents/slide-reviewer.md` です。
reviewer を手動で呼ぶ場合は、必ずそのファイルを読ませてください。

メイン agent として知っておくべきこと:

- reviewer は判定だけを行い、スライド本文を編集しない
- 使ってよい status は `missing_info`、`fail`、`pass` のみ
- ページ画像を確認しない限り `pass` は返さない
- `fail` のときは `exact_fix_instructions` に従って修正する
- `missing_info` のときは `questions_for_user` をユーザーに確認する

## 完了条件

このスキルは、次のすべてが真のときに限り完了です:

1. `.slide-work/review.json.status == "pass"`
2. `missing_required`、`issues`、`questions_for_user`、`exact_fix_instructions` がすべて空配列である
3. `quality.visual_quality.hierarchy == "pass"`
4. `quality.visual_quality.whitespace == "pass"`
5. `quality.visual_quality.alignment == "pass"`
6. `quality.visual_quality.consistency == "pass"`
7. `quality.visual_quality.density == "pass"`
8. `quality.visual_quality.variety == "pass"`
9. `quality.visual_quality.accessibility == "pass"`
10. `quality.story_quality.clear_takeaway_each_slide == true`
11. `quality.story_quality.logical_flow == true`
12. `quality.story_quality.opening_is_strong == true`
13. `quality.story_quality.closing_has_action == true`
14. `quality.deck_metrics.bullet_only_slide_ratio <= 0.3`
15. `quality.deck_metrics.dominant_archetype_ratio <= 0.4`
16. `quality.deck_metrics.assertion_title_failures` が空配列である
17. `quality.deck_metrics.key_number_emphasis_failures` が空配列である
18. `quality.design_warnings` が空配列である
19. `validation.source_checks.status == "pass"`
20. `validation.exports.required_formats_satisfied == true`
21. `validation.visual_review.executed == true`
22. `validation.visual_review.status == "pass"`
23. `validation.visual_review.checked_page_count > 0`
24. `artifacts.pdf == ".slide-work/presentation.pdf"`
25. `artifacts.page_images` に `.slide-work/rendered-pages/page-###.png` が含まれている
26. ワークフローにユーザー承認が含まれる場合、`request.yaml.approval.draft_approved == true`

いずれか 1 つでも欠けていれば、そのタスクは未完了です。

## 運用ルール

- `settings.json` に依存してはいけません。hooks の正本は `../../hooks/hooks.json` です
- 作業ディレクトリは常に `.slide-work/...` と表記してください
- 古い `pass` を近道として保持してはいけません
- ユーザーが別の design reference を明示しない限り、`templates/presentation-starter.md` を既定にしてください
- `design-system.yaml` と `slide-plan.yaml` を飛ばして本文を書いてはいけません
- reviewer が `fail` を返したら、デッキを修正して再レビューしてください
- reviewer が `missing_info` を返したら、ユーザーに戻ってください
- `pass` の後であっても、visual review、export validation、reviewer 自前の source checks なしに stop してはいけません
- host が hooks を使えない場合は、同じルールを手動で適用してください

## エクスポート失敗時の対処

`marp_export` が失敗する主な原因と対処:

- **Docker 未起動**: `marp` MCP サーバーは Docker 上で動作する。Docker Desktop が起動しているか確認し、起動していなければユーザーに伝える
- **Marp 構文エラー**: frontmatter に `marp: true` がない、HTML タグ使用時に `html: true` がない、または不正な Markdown 構文が原因。エラーメッセージから該当箇所を特定し `slides/presentation.md` を修正する
- **タイムアウト**: 大量のスライドや重い背景画像が原因になりうる。スライド枚数を分割するか、画像を軽量化する
- **PNG 未生成**: export は成功したがページ画像が 0 枚の場合は、output パスの指定を確認する。期待するパスは `.slide-work/rendered-pages/page.png`（MCP サーバーが `page-001.png` 等に正規化する）

エクスポート失敗時はそのまま pass に進めず、原因を特定してから再試行してください。

## 参照マップ

- `../../agents/structure-consultant.md`: 構成コンサルタント（S2 で使用）
- `../../agents/slide-reviewer.md`: reviewer 契約
- `templates/request-template.yaml`: request state のテンプレート
- `templates/outline-template.yaml`: outline state のテンプレート
- `templates/design-system-template.yaml`: design system state のテンプレート
- `templates/slide-plan-template.yaml`: slide plan state のテンプレート
- `templates/review-template.json`: review state のテンプレート
- `templates/presentation-starter.md`: 既定のデザイン参照を内包した Marp スターター
- `references/presentation-structures.md`: アウトラインのパターン
- `references/layout-patterns.md`: archetype とレイアウトの指針
- `references/design-reference-playbook.md`: 既存デッキのスタイル適用方法
