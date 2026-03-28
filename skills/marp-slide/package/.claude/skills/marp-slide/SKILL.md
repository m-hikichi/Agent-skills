---
name: marp-slide
description: Marp スライドの計画、作成、レビュー、エクスポートにはこのスキルを使ってください。ワークフローは状態駆動で、スライドのページ画像を使った visual review の後に reviewer が pass を返すまで完了してはいけません。
hooks:
  PostToolUse:
    - matcher: Write|Edit|MultiEdit|Bash
      hooks:
        - type: agent
          model: sonnet
          prompt: |
            あなたは marp-slide の review refresh hook です。
            最初に `.claude/agents/slide-reviewer.md` を読み、それを reviewer 契約の正本として扱ってください。ただし、この hook が名前付き custom agent を直接指定できる前提には依存しないでください。

            freshness 判定に関係する入力は次のとおりです:
            - `.slide-work/request.yaml`
            - `.slide-work/outline.yaml`
            - `slides/presentation.md`
            - `.slide-work/review.json`

            必須の挙動:
            - `slides/presentation.md` がまだ存在しない場合に限り、`{"ok": true, "skipped": true, "reason": "slides/presentation.md はまだ存在しません"}` を返して構いません。
            - 直近の tool use によって `slides/presentation.md`、`.slide-work/request.yaml`、または `.slide-work/outline.yaml` が変更された、または変更された可能性がある場合は、reviewer の完全なワークフローを実行し、`.slide-work/review.json` を上書きしてください。
            - changed-file metadata が使えない場合は、関連ファイルのタイムスタンプと `review.json.reviewed_at` を比較してください。freshness を証明できない場合は、reviewer の完全なワークフローを再実行してください。
            - `.slide-work/review.json` が存在し、かつ次のすべてを含まない限り、その review は fresh ではありません:
              - `reviewed_at`
              - `artifacts.pdf == ".slide-work/presentation.pdf"`
              - 空でない `artifacts.page_images`
              - `validation.source_checks`
              - `validation.exports`
              - `validation.visual_review.executed == true`
              - `validation.visual_review.checked_page_count > 0`
            - 必要な review refresh を実行せずに `{"ok": true}` を返す抜け道を作ってはいけません。

            reviewer を再実行した場合は、`{"ok": true, "skipped": false, "review_status": "<status>"}` を返してください。
            すでに review が fresh で、かつ関連ファイルに変更がない場合に限り、`{"ok": true, "skipped": true}` を返して構いません。
  Stop:
    - hooks:
        - type: agent
          model: sonnet
          prompt: |
            あなたは marp-slide の completion gate です。
            最初に `.claude/agents/slide-reviewer.md` を読み、それを reviewer 契約の正本として扱ってください。ただし、この hook が名前付き custom agent を直接指定できる前提には依存しないでください。

            `slides/presentation.md` が存在する場合、stop を許可する前に最新の完全 review が必須です。
            次を満たす `.slide-work/review.json` が存在するときに限り、その review は最新です:
            - `reviewed_at`
            - `artifacts.pdf == ".slide-work/presentation.pdf"`
            - 空でない `artifacts.page_images`
            - `validation.source_checks.status == "pass"`
            - `validation.exports.required_formats_satisfied == true`
            - `validation.visual_review.executed == true`
            - `validation.visual_review.status == "pass"`
            - `validation.visual_review.checked_page_count > 0`

            freshness を証明できない場合は、完了可否を判定する前に reviewer の完全なワークフローを再実行してください。

            次のすべてが真のときに限り、完了を許可してください:
            1. `.slide-work/review.json.status == "pass"`
            2. `missing_required`、`issues`、`questions_for_user`、`exact_fix_instructions` がすべて空配列である
            3. `validation.source_checks.status == "pass"`
            4. `validation.exports.required_formats_satisfied == true`
            5. `validation.visual_review.executed == true`
            6. `validation.visual_review.status == "pass"`
            7. `validation.visual_review.checked_page_count > 0`
            8. `artifacts.page_images` に少なくとも 1 つの `.slide-work/rendered-pages/page-###.png` が含まれている

            `slides/presentation.md` がまだ存在しない場合は、必須情報の不足やアウトライン承認待ちのような正当な待機状態に限って stop を許可してください。ドラフトが存在しないまま、タスク完了済みであるかのように stop を許可してはいけません。

            gate が満たされる前に `{"ok": true}` を返す抜け道を作ってはいけません。
            いずれかの条件を満たさない場合は、`{"ok": false, "reason": "review gate が満たされていません: <status or missing requirement>. review.json.questions_for_user または review.json.exact_fix_instructions に正確に従ってください."}` を返してください。
            completion gate が満たされた後にのみ `{"ok": true}` を返してください。
---

# Marp Slide スキル

## 目的

このスキルは、Marp の作業を状態機械として進めるために使います:

1. 要件を収集する
2. アウトラインを提案する
3. `slides/presentation.md` を作成する
4. レビューする
5. pass になるまで修正と再レビューを繰り返す
6. review gate を満たした後にのみ完了する

完了判定の source of truth は、常に最新の `.slide-work/review.json` です。
口調、経過時間、あるいは「たぶん十分よさそう」といった推測で完了を判断してはいけません。

## ツール境界

- `marp` MCP サーバーが扱うのは `marp_export` だけです
- Visual review は MCP の責務ではありません
- Visual review では `.slide-work/rendered-pages/page-###.png` を確認しなければなりません
- reviewer は判定と `.slide-work/review.json` の書き換えだけを行い、スライド修正は行いません

## 作業ファイル

主なファイル:

- `.slide-work/request.yaml`
- `.slide-work/outline.yaml`
- `.slide-work/review.json`
- `.slide-work/preview.html`
- `.slide-work/presentation.pdf`
- `.slide-work/presentation.pptx`
- `.slide-work/rendered-pages/page-###.png`
- `slides/presentation.md`

補助ファイル:

- `templates/request-template.yaml`
- `templates/outline-template.yaml`
- `templates/review-template.json`
- `templates/presentation-starter.md`
- `references/presentation-structures.md`
- `references/layout-patterns.md`
- `references/design-reference-playbook.md`

## 必須のリクエスト項目

`.slide-work/request.yaml` では次の項目を必須として扱います:

- `topic`
- `audience`
- `audience_knowledge`
- `presentation_context`
- `goal`
- `target_slide_count`
- `output_formats`

いずれかの必須項目が空、null、または実質的に欠落している場合、そのタスクは `missing_info` 状態にあり、推測で先へ進めてはいけません。

## 状態機械

### S0. 初期化

1. `.slide-work/` を作成する
2. `templates/request-template.yaml` から `.slide-work/request.yaml` を初期化する
3. `templates/outline-template.yaml` から `.slide-work/outline.yaml` を初期化する
4. `templates/review-template.json` から `.slide-work/review.json` を初期化する

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
- アウトライン承認前にスライド本文を作成してはいけない

次の場合に抜ける:

- ユーザーがアウトラインを承認し、`request.yaml.approval.outline_approved` を `true` にできる

### S3. ドラフト作成

次の場合に入る:

- `approval.outline_approved == true`

行うこと:

- `slides/presentation.md` を作成または更新する
- `templates/presentation-starter.md` をベースとして使う
- `references/layout-patterns.md` と `references/design-reference-playbook.md` を補助として使う
- 1 スライド 1 メッセージと低い情報密度を優先する

次の場合に抜ける:

- `slides/presentation.md` が存在し、レビュー可能な状態になっている

### S4. レビュー必須

次の場合に入る:

- `slides/presentation.md` が作成された
- `slides/presentation.md`、`.slide-work/request.yaml`、または `.slide-work/outline.yaml` が変更された
- 既存の review が欠けている、stale である、不完全である、または visual review を欠いている

行うこと:

- hook による reviewer 再実行に依存する
- hook が動かなかった場合、または freshness を証明できない場合は、`agents/slide-reviewer.md` を使って reviewer を手動で再実行する

次の場合に抜ける:

- fresh な `.slide-work/review.json` が存在する

### S5. Review 結果 = `missing_info`

次の場合に入る:

- `.slide-work/review.json.status == "missing_info"`

行うこと:

- `review.json.questions_for_user` にある質問を、そのままユーザーに確認する
- 不足情報を推測してはいけない
- `request.yaml` または `outline.yaml` を更新する
- S4 に戻る

### S6. Review 結果 = `fail`

次の場合に入る:

- `.slide-work/review.json.status == "fail"`

行うこと:

- `review.json.exact_fix_instructions` を読む
- その修正を作業ファイルへ適用する
- その指示が未解決のまま stop してはいけない
- 編集後に S4 へ戻る

### S7. Review 結果 = `pass`

次の場合に入る:

- `.slide-work/review.json.status == "pass"`

すぐに完了してはいけません。まず次のすべてを確認してください:

- `validation.source_checks.status == "pass"`
- `validation.exports.required_formats_satisfied == true`
- `validation.visual_review.executed == true`
- `validation.visual_review.status == "pass"`
- `validation.visual_review.checked_page_count > 0`
- `artifacts.pdf == ".slide-work/presentation.pdf"`
- `artifacts.page_images` が空ではない

ユーザーまたはメイン agent が pass 後に内容を変更した場合、古い pass は無視して S4 に戻ってください。

## Review freshness ルール

次のいずれかが真であれば、その review は stale とみなします:

- `.slide-work/review.json` が存在しない
- `reviewed_at` が存在しない
- `slides/presentation.md` が `reviewed_at` より新しい
- `.slide-work/request.yaml` が `reviewed_at` より新しい
- `.slide-work/outline.yaml` が `reviewed_at` より新しい
- `artifacts.pdf` が `.slide-work/presentation.pdf` ではない
- `artifacts.page_images` が空である
- `validation.visual_review.executed != true`
- `validation.visual_review.checked_page_count <= 0`
- `validation.exports.required_formats_satisfied != true`

stale な pass を完了根拠に使ってはいけません。

## Reviewer 契約

reviewer の source of truth は `agents/slide-reviewer.md` です。
reviewer は次を満たさなければなりません:

- `slides/presentation.md` を PDF にエクスポートする
- スライドごとの PNG 画像を `.slide-work/rendered-pages/page-###.png` にエクスポートする
- それらのページ画像を確認するまでは `pass` を返してはいけない
- 実行のたびに `review.json` を上書きする
- 使ってよい status は `missing_info`、`fail`、`pass` のみ
- `fail` のときは `exact_fix_instructions` を埋める
- `missing_info` のときは `questions_for_user` を埋める
- スライド本文の編集は避ける

## 完了条件

このスキルは、次のすべてが真のときに限り完了です:

1. `.slide-work/review.json.status == "pass"`
2. `missing_required`、`issues`、`questions_for_user`、`exact_fix_instructions` がすべて空配列である
3. `validation.source_checks.status == "pass"`
4. `validation.exports.required_formats_satisfied == true`
5. `validation.visual_review.executed == true`
6. `validation.visual_review.status == "pass"`
7. `validation.visual_review.checked_page_count > 0`
8. `artifacts.pdf == ".slide-work/presentation.pdf"`
9. `artifacts.page_images` に `.slide-work/rendered-pages/page-###.png` が含まれている
10. ワークフローにユーザー承認が含まれる場合、`request.yaml.approval.draft_approved == true`

いずれか 1 つでも欠けていれば、そのタスクは未完了です。

## 運用ルール

- `settings.json` に依存してはいけません。hooks はこのファイルの frontmatter が持ちます
- 作業ディレクトリは常に `.slide-work/...` と表記してください
- 古い `pass` を近道として保持してはいけません
- reviewer が `fail` を返したら、デッキを修正して再レビューしてください
- reviewer が `missing_info` を返したら、ユーザーに戻ってください
- `pass` の後であっても、visual review、export validation、reviewer 自前の source checks なしに stop してはいけません
- host が hooks を使えない場合は、同じルールを手動で適用してください

## 参照マップ

- `agents/slide-reviewer.md`: reviewer 契約
- `templates/request-template.yaml`: request state のテンプレート
- `templates/outline-template.yaml`: outline state のテンプレート
- `templates/review-template.json`: review state のテンプレート
- `templates/presentation-starter.md`: 最小構成の Marp スターター
- `references/presentation-structures.md`: アウトラインのパターン
- `references/layout-patterns.md`: レイアウトと情報密度の指針
- `references/design-reference-playbook.md`: 既存デッキのスタイル適用方法
