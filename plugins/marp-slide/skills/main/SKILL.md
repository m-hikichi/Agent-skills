---
name: main
description: Marpスライドを、聞き手・目的・根拠・発表条件に合わせて設計し、外部テーマとローカル画像/SVGを使って作成し、独立reviewerによる証拠ベースの品質審査後にPDF/PNGへ出力する。提案、報告、研修、研究、経営更新の資料作成で使用する。
model: opus
effort: xhigh
---

# Marp Slide

聞き手が理解・判断・行動できる資料を作る。規約への機械的な適合ではなく、目的適合、根拠、視覚表現、可読性を優先する。

## 完了条件

現在の `slides/presentation.md` と一致する、`rubric_version: 2` かつ `status: "pass"` の `.slide-work/review.json` が必要。reviewerは作成者と別コンテキストで実行し、全ページPNGを確認する。

## S1. Gather

新規案件では `templates/request-template.yaml` を `.slide-work/request.yaml` にコピーし、会話から次を埋める。

必須:

- `topic`, `audience`, `presentation_type`, `goal`, `target_slide_count`
- `must_include`, `source_materials`, `output_formats`

必要な場合だけ確認:

- `delivery_mode`: `live | read-ahead | hybrid`
- `duration_minutes`, `desired_tone`, `audience_decision_criteria`
- `brand_constraints`, `design_reference`, `available_assets`
- `evidence_policy`, `slide_count_mode`: `exact | target | flexible`

未指定時は、`delivery_mode: live`、`slide_count_mode: target`、`evidence_policy: cite-or-label-assumption` とする。実績値を捏造しない。確認できない推定は「仮説」「要確認」など、出力言語に合うラベルを付ける。

`references/presentation-structures.md` の該当タイプだけを読み、聞き手に必要な流れを決める。全タイプに同じ冒頭・結びを強制しない。

## S2. Storyboard

Markdownを作る前に `.slide-work/storyboard.md` を作成する。

```markdown
| # | スライドの役割 | キーメッセージ | 根拠・出典 | 視覚表現 | 発表時の補足 |
|---|----------------|----------------|-------------|----------|--------------|
```

- 各スライドが聞き手の理解や判断にどう寄与するかを書く。
- 事実、数値、引用には出典を対応させる。未確認値は仮説として扱う。
- 主張、比較、時系列、構造、数値、写真などから意味に合う視覚表現を選ぶ。
- proposal / executive-updateでは結論先行と判断要求を重視する。
- report / researchでは方法、根拠、限界を含める。
- trainingでは学習目標、説明、実践、確認を優先する。
- タイトルは原則として内容を伝える文にするが、方法、演習、章区切りなどは明確なトピックタイトルでもよい。

ユーザーが裁量を明示していれば、前提とタイトル一覧を短く提示してドラフトへ進む。判断要求や根拠の解釈が曖昧なら確認する。

## S3. Draft

### テーマ

デザイン指定がなければ次を既定とする。

| presentation_type | theme |
|---|---|
| proposal / executive-update | `executive-clean` |
| report / research | `editorial` |
| training | `technical` |

選んだ `templates/themes/<theme>.css` を `slides/theme.css` にコピーし、frontmatterの `theme` をCSS内の `@theme` 名に合わせる。既存のinline CSSやユーザー指定テーマを踏襲する場合は、無理に置き換えない。

該当タイプの `templates/examples/<presentation_type>.md` と `references/layout-patterns.md` を参考にする。例を複製せず、内容に合う構成と視覚表現を選ぶ。

### アセット

- PNG、JPG、WebP、SVGを `slides/assets/` に置いて使用できる。
- 外部素材は `slides/assets/SOURCES.md` に出典、URL、ライセンスを記録する。
- Mermaidは実行時JavaScriptに依存させず、利用可能な変換手段でSVGにしてから配置する。
- アイコンや写真は理解を助ける場合だけ使う。
- 生の数値から作る図表は、軸、単位、期間、出典を明示する。

### 作成基準

- 1枚の中心メッセージを明確にし、視線の入口と情報の優先順位を作る。
- 文字量は固定行数で決めず、発表形態とレンダリング結果で判断する。
- `live` は一目で理解できる密度、`read-ahead` は自立して読める説明量にする。
- proposal / executive-updateのみ、必要な判断または次の行動を明確にする。
- 事実と解釈、実績と仮説を見分けられるようにする。
- ローカルCSSの追加は許容するが、既存テーマで表現できない理由がある場合に限る。

作成後に次を実行する。

```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/deck-lint.sh" \
  --source slides/presentation.md \
  --target <target_slide_count> \
  --slide-count-mode <exact|target|flexible> \
  --theme slides/theme.css
```

lintのFAILを修正し、WARNは要件に照らして判断する。

## S4. Independent Review

1. 既存レビューが `review_attempt >= 3` かつ `fail` なら、自動修正を止めてユーザーへ主要問題を示す。
2. 続行できる場合は `bash "${CLAUDE_PLUGIN_ROOT}/scripts/review-gate.sh" prepare` を実行し、返された `source_sha256` と `review_attempt` を取得する。
3. reviewerサブエージェントを呼び、prepareの値を渡す。3回目のレビューまでは実行してよい。
4. `status` に応じて処理する。
   - `pass`: S5へ進む。
   - `missing_info`: `questions_for_user` を確認して要件を更新する。
   - `fail`: critical / majorを優先し、問題間の関係を整理した一貫した改稿を1回行う。
   - `infra_blocked`: Dockerやテーマファイルなど、環境原因だけを案内する。

reviewerの提案を無条件に全適用しない。局所修正がストーリーやデザイン全体を壊さないよう統合する。minorだけならpass可能だが、改善価値が高ければ合わせて直す。

reviewerを起動できない場合は、現在のソースハッシュを持つ `.slide-work/review-blocked.json` を書き、未完了として停止する。自己判定でpassを作らない。

## S5. Export

レビュー時にPDF/PNGは生成済み。追加形式が必要なら、外部テーマを使うデッキでは `theme: "slides/theme.css"` を付けて `marp_export` を呼ぶ。最終報告では出力ファイル、使用テーマ、未解決のminor事項を示す。

## 残すべき規律

- reviewerは作成者から独立させる。
- 全ページPNGを実際に確認する。
- 出典のない事実・数値をもっともらしく補わない。
- レビュー後にソースを変更したら、古いpassを再利用しない。
- PDF/PNG生成にはMCP `marp_export` を使う。
