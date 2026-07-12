---
name: main
description: Marpで、意思決定資料、分析read-ahead、研修、研究報告などを高品質に設計・制作する。要求と根拠を棚卸しし、action titleで論理を検査し、写真・データチャート・静的図解を組み合わせ、全ページ画像と独立した内容・視覚レビューを通してPDF/PNG/HTML/PPTXへ仕上げる。ユーザーが「スライドを作る」「Marp資料」「プレゼンを見やすく」「図やグラフを使った資料」と依頼したら使う。
model: opus
effort: xhigh
---

# Marp Slide

聞き手が理解し、判断し、行動できる資料を作る。Marp Markdownを書く前に論理とvisual briefを設計し、レンダー後に必ず一度は直す。

## 成果物と完了条件

作業用ファイルは `.slide-work/`、編集可能な原稿とローカル素材は `slides/` に置く。

- `request.yaml`, `storyboard.md`, `deck-plan.json`
- `asset-manifest.json`, `render-manifest.json`, `run-state.json`
- `content-review.json`, `visual-review.json`, 統合済み `review.json`
- `slides/presentation.md`, `slides/theme.css`, `slides/assets/`
- 全ページ2倍PNG、contact sheet、指定された最終形式、notes

完了には、現行入力の統合fingerprintと一致するrubric v3 pass、2回以上のレンダー、1件以上の具体的な改善記録が必要。初回レンダーをfinalizeしない。

ライフサイクルCLIはホストNodeを前提にしない。PowerShellでは `& "$env:CLAUDE_PLUGIN_ROOT/scripts/run-cli.ps1"`、POSIX shellでは `bash "$CLAUDE_PLUGIN_ROOT/scripts/run-cli.sh"` を使う。どちらもNodeがなければ固定Docker imageへ自動的にfallbackする。以下の `<marp-slide-cli>` は、この環境別launcherを表し、文字どおりのcommand名として実行しない。

新規案件では、既定の作業領域を初期化する。

```bash
<marp-slide-cli> init --root .
```

## 1. Source inventory

`templates/request-template.yaml` から要求を記録する。依頼文、添付、既存ブランド、利用可能な画像、数値の単位・期間・母数・出典を棚卸しし、各根拠へ安定したIDを付ける。確認できない値を補完せず、仮説または要確認として分離する。

必須情報がなく回答を待つ場合は、質問を記録してから `<marp-slide-cli> set-status --root . --status needs_user --message "不足情報の回答待ち"` を実行して停止する。回答を受けたら、作業再開前に `<marp-slide-cli> set-status --root . --status active` を実行する。

`references/narrative.md` を読み、成功条件、1文のdeck thesis、3〜5個の根拠を決める。資料タイプ固有の流れが必要なときだけ `references/type-recipes.md` の該当節を読む。

## 2. Narrative spineとghost-deck test

`templates/storyboard-template.md` から `storyboard.md` を作る。各ページを結論または明確な問いを表すaction titleで並べ、タイトル列だけを読んでも「なぜ→何が分かった→だから何をする」が通じるか検査する。章順の転記、重複、根拠のない飛躍を直してから制作へ進む。

## 3. Deck planとvisual brief

`references/visual-grammar.md` を読み、`templates/deck-plan-template.json` からページ計画を作る。各ページに `role`, `action_title`, `narrative_goal`, `evidence_ids`, `visual_kind`, `visual_brief`, `layout`, `density`, `citation`, `alt`, `speaker_notes` を記録する。

`visual_brief` は配置の指定ではなく、**何を見せ、聞き手に何を読み取らせるか**を書く。palette、書体、余白、画像処理、反復モチーフ、密度をvisual directionとして先に固定し、資料タイプだけで色を決めない。

## 4. 統合承認を1回取る

実内容を使った表紙または代表ページを3案レンダーする。色違いではなく、階層・構図・画像処理・トーンの異なる案にする。次を一度に提示して確認する。

1. deck thesisとaction-title一覧
2. visual direction
3. 3案の実画像
4. 推奨案と、その聞き手・目的に合う理由

`approval_mode: single-checkpoint` では、この確認後に細部の承認を繰り返さない。`autonomous` では推奨案を採用し、判断理由を記録する。

`single-checkpoint`で案を提示する直前に `<marp-slide-cli> set-status --root . --status needs_user --message "統合デザイン案の確認待ち"` を実行する。ユーザーの選択を受けた次のturnでは、最初に `<marp-slide-cli> set-status --root . --status active` を実行してから制作へ進む。これにより、承認待ちを未完了のまま安全に停止できる。

## 5. Hybrid asset pipeline

`references/asset-pipeline.md` を読む。優先順位は、ユーザー提供素材 → 元データから作るチャート／構造図 → ライセンス確認済みWeb素材 → 概念用AI画像。

- チャートはCSV/JSONとVega-Lite specから静的SVGを生成し、軸・単位・期間・出典・結論注釈を含める。
- 図解はMermaid sourceと静的SVGを残す。runtime JavaScriptへ依存しない。
- AI画像に文章、数値、グラフを描かせない。
- 全素材を `asset-manifest.json` へ登録し、意味のある画像には具体的なaltを付ける。

## 6. Marp compose

`templates/themes/README.md` に従い、base、profile、deck tokensを単一の `slides/theme.css` へcompileする。gold deckは構成と表現の参考であり、文面やページ列を複製しない。

- `templates/examples/gold/executive-decision.md`
- `templates/examples/gold/analytical-read-ahead.md`
- `templates/examples/gold/technical-training.md`
- `templates/component-gallery.md`（pure Markdownでの部品記法だけを確認するとき）

frontmatterのHTML実行許可、inline styleの疑似グラフ、workspace外を参照するCSS/SVGを使わない。`lang`, `title`, `description`, `author` を設定する。`live` と `hybrid` ではstoryboardの補足をMarpit presenter notesへ移す。

## 7. Renderとmachine QA

compose後に `<marp-slide-cli> lint --root .` を実行し、構造上のfailを直す。次に `marp_render_deck({source: "slides/presentation.md", theme: "slides/theme.css", formats: ["pdf", "png"], output_dir: ".slide-work", image_scale: 2})` を呼ぶ。`formats`は例であり、実際にはreview用`png`と`request.output_formats`で指定された`pdf | html | pptx`の和集合にする。`notes`はformatsへ渡さなくても常に別ファイルで生成される。レンダラーが `.slide-work/render-manifest.json`、`.slide-work/machine-qa.json`、全ページPNG、contact sheet、notesを同じ条件で生成する。

`references/quality-assurance.md` に従い、ページ数、欠損asset、overflow、clip、最小文字、contrast、alt、チャート尺度、fingerprintを確認する。geometry checkが`not_run`ならpassにしない。Markdownだけを見て可読性を判断しない。

rendererや必要入力へアクセスできず進行不能なら、原因と再開条件を記録して `<marp-slide-cli> set-status --root . --status blocked --message "<具体的な阻害条件>"` を実行する。外部条件が解消したら`active`へ戻す。難しい、時間がかかる、修正が残るという理由だけで`blocked`にしない。

## 8. 独立した二系統レビュー

作成者とは別コンテキストで、同じrequest、plan、根拠、render manifestを渡す。

- `content-reviewer`: 聞き手、論理、action title、根拠、仮説、notesを評価し、`content-review.json` を書く。
- `visual-reviewer`: contact sheetでデッキ全体のリズムを確認後、全2倍PNGを1枚ずつ評価し、`visual-review.json` を書く。

`<marp-slide-cli> prepare-review --root .` の`artifact_fingerprint`と`review_attempt`を両reviewerへ渡す。両結果と、レンダラーが書いた `.slide-work/machine-qa.json` を `$CLAUDE_PLUGIN_ROOT/schemas/review.schema.json` が定めるrubric v3へ統合する。`content-review.json` のhard gates／scoresは`content_review`へ、`visual-review.json` のcontact sheet／page list／hard gates／scores／page findingsは`visual_review`へ写し、issuesとstrengthsは重複を除いてトップレベルへ集約する。中間reviewer用の`reviewer`など、schemaにないkeyを`review.json`へ持ち込まない。content reviewerが`needs_user`なら統合statusも`needs_user`、入力へアクセス不能なら`blocked`にする。

machine QAのpassを手で捏造しない。critical/major、hard gate fail、評価3以下が残る状態をpassにしない。reviewerが実画像を見られない場合は `blocked` とし、自己判定でpassを作らない。

統合後は `<marp-slide-cli> validate-review --root .` で厳密schemaとartifact整合を検証する。

## 9. 必須の修正・再レンダー

初回レビューから最も影響の大きい問題をまとめて直す。次のrenderを実行する前に、変更対象ページと具体的な理由を `render-manifest.json` の`improvements`へ、次のiteration番号で追記する。レンダラーはそのentryを保持してiterationを進める。全入力を再fingerprintし、全形式を再レンダーし、machine QAと二系統レビューを再実行する。レビュー後のソース、theme、request、asset変更は古いpassを失効させる。

## 10. Finalize

`<marp-slide-cli> finalize --root .` で、現行fingerprint、rubric v3 pass、実PNG数とスライド数、PNG hash・寸法、2回以上のrender、現iterationの改善履歴を検証する。指定されたPDF/PNG/HTML/PPTXとnotesを渡す。通常PPTXは画像ベースで、オブジェクト単位の編集性は保証しない。未解決のminorと素材ライセンス条件を最終報告に含める。
