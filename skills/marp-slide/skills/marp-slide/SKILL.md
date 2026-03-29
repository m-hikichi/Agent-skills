---
name: marp-slide
description: Marp スライドの要件整理、デザインシステム設計、スライド計画、作成、レビュー、エクスポートにはこのスキルを使ってください。`.slide-work/design-system.yaml` と `.slide-work/slide-plan.yaml` を先に作り、スライド画像を使った visual review と quality rubric が pass になるまで完了してはいけません。
---

# Marp Slide スキル

## 目的

このスキルは、Marp の作業を状態機械として進めるために使います:

1. 要件を収集する
2. アウトラインを提案する
3. `.slide-work/design-system.yaml` を作る
4. `.slide-work/slide-plan.yaml` を作る
5. `slides/presentation.md` を作成する
6. レビューする
7. pass になるまで修正と再レビューを繰り返す
8. review gate を満たした後にのみ完了する

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

行うこと:

- `request.yaml` を埋める
- `missing_required` と `open_questions` を最新に保つ
- 実際に進行を妨げている不足項目だけを質問する

次の場合に抜ける:

- 必須項目がすべて埋まっている

### S2. アウトライン提案

次の場合に入る:

- `request.yaml` に必須項目がすべて入っている

行うこと:

- `references/presentation-structures.md` を使ってアウトラインを作成する
- それを `.slide-work/outline.yaml` に保存する
- 2 枚目を executive summary、最後を next action に寄せる
- アウトライン承認前にスライド本文を作成してはいけない

次の場合に抜ける:

- ユーザーがアウトラインを承認し、`request.yaml.approval.outline_approved` を `true` にできる

### S3. デザインシステム設計

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

### S4. スライド計画

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

### S5. ドラフト作成

次の場合に入る:

- `approval.outline_approved == true`
- `.slide-work/design-system.yaml` が存在する
- `.slide-work/slide-plan.yaml` が存在する

行うこと:

- `slides/presentation.md` を作成または更新する
- `templates/presentation-starter.md` をベースとして使う
- `design_reference` が空なら、`templates/presentation-starter.md` の frontmatter と class vocabulary を優先して継承する
- `references/layout-patterns.md` と `references/design-reference-playbook.md` を補助として使う
- slide plan の archetype を、そのまま Marp 実装に落とし込む
- 1 スライド 1 メッセージと低い情報密度を守る
- タイトルはトピック名ではなく takeaway を断定的に書く
- bullet はタイトルの補強だけに使い、タイトルの言い換えを並べない
- 重要な数字や結論だけを視覚的に強調する
- global directives で theme、paginate、header、footer を整え、local class directives で archetype を切り替える
- background image はメッセージを強める場合にだけ使い、飾り目的では使わない
- split background は `section-divider` または比較スライドに限って使う

次の場合に抜ける:

- `slides/presentation.md` が存在し、レビュー可能な状態になっている

### S6. レビュー必須

次の場合に入る:

- `slides/presentation.md` が作成された
- `slides/presentation.md`、`.slide-work/request.yaml`、`.slide-work/outline.yaml`、`.slide-work/design-system.yaml`、または `.slide-work/slide-plan.yaml` が変更された
- 既存の review が欠けている、stale である、不完全である、または visual review を欠いている

行うこと:

- hook による reviewer 再実行に依存する
- hook が動かなかった場合、または freshness を証明できない場合は、`../../agents/slide-reviewer.md` を使って reviewer を手動で再実行する

次の場合に抜ける:

- fresh な `.slide-work/review.json` が存在する

### S7. Review 結果 = `missing_info`

次の場合に入る:

- `.slide-work/review.json.status == "missing_info"`

行うこと:

- `review.json.questions_for_user` にある質問を、そのままユーザーに確認する
- 不足情報を推測してはいけない
- `request.yaml` または `outline.yaml` を更新する
- 必要なら `design-system.yaml` を更新する
- S6 に戻る

### S8. Review 結果 = `fail`

次の場合に入る:

- `.slide-work/review.json.status == "fail"`

行うこと:

- `review.json.exact_fix_instructions` を読む
- その修正を作業ファイルへ適用する
- 必要なら `design-system.yaml` または `slide-plan.yaml` に戻って設計をやり直す
- その指示が未解決のまま stop してはいけない
- 編集後に S6 へ戻る

### S9. Review 結果 = `pass`

次の場合に入る:

- `.slide-work/review.json.status == "pass"`

すぐに完了してはいけません。まず次のすべてを確認してください:

- `quality.visual_quality.hierarchy == "pass"`
- `quality.visual_quality.whitespace == "pass"`
- `quality.visual_quality.alignment == "pass"`
- `quality.visual_quality.consistency == "pass"`
- `quality.visual_quality.density == "pass"`
- `quality.visual_quality.variety == "pass"`
- `quality.visual_quality.accessibility == "pass"`
- `quality.story_quality.clear_takeaway_each_slide == true`
- `quality.story_quality.logical_flow == true`
- `quality.story_quality.opening_is_strong == true`
- `quality.story_quality.closing_has_action == true`
- `quality.deck_metrics.bullet_only_slide_ratio <= 0.3`
- `quality.deck_metrics.dominant_archetype_ratio <= 0.4`
- `quality.deck_metrics.assertion_title_failures` が空配列である
- `quality.deck_metrics.key_number_emphasis_failures` が空配列である
- `quality.design_warnings` が空配列である
- `validation.source_checks.status == "pass"`
- `validation.exports.required_formats_satisfied == true`
- `validation.visual_review.executed == true`
- `validation.visual_review.status == "pass"`
- `validation.visual_review.checked_page_count > 0`
- `artifacts.pdf == ".slide-work/presentation.pdf"`
- `artifacts.page_images` が空ではない

ユーザーまたはメイン agent が pass 後に内容を変更した場合、古い pass は無視して S6 に戻ってください。

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

reviewer の source of truth は `../../agents/slide-reviewer.md` です。
reviewer は次を満たさなければなりません:

- `request.yaml`、`outline.yaml`、`design-system.yaml`、`slide-plan.yaml`、`slides/presentation.md` を読む
- `slides/presentation.md` を PDF にエクスポートする
- スライドごとの PNG 画像を `.slide-work/rendered-pages/page-###.png` にエクスポートする
- それらのページ画像を確認するまでは `pass` を返してはいけない
- 実行のたびに `review.json` を上書きする
- `quality.visual_quality`、`quality.story_quality`、`quality.deck_metrics` を記録する
- 使ってよい status は `missing_info`、`fail`、`pass` のみ
- `fail` のときは `exact_fix_instructions` を埋める
- `missing_info` のときは `questions_for_user` を埋める
- スライド本文の編集は避ける

## Visual Quality Rubric

reviewer は少なくとも次の観点を `pass` / `fail` で判定してください:

- `hierarchy`
- `whitespace`
- `alignment`
- `consistency`
- `density`
- `variety`
- `accessibility`

さらに次の story quality を評価してください:

- `clear_takeaway_each_slide`
- `logical_flow`
- `opening_is_strong`
- `closing_has_action`

次のいずれかが真なら `fail` を返してください:

- 箇条書きだけのスライドが全体の 30% を超える
- 同一 archetype が全体の 40% を超える
- 7 枚以上のデッキで section divider が 0 枚である
- takeaway ではなくトピック名だけの見出しが残っている
- 重要な数字や結論が視覚的に埋もれている
- visual quality のいずれかが fail である

1 枚の本文が plan の上限、または 6 行を超える場合は少なくとも warning を出し、複数枚で続くなら fail にしてください。

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

## 参照マップ

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
