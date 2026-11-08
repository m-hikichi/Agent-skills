---
name: slide-review
description: Marp資料の初見・内容・視覚レビューを独立して実施し、rubric v4の証跡を統合・検証する。生成済み資料の審査と制作後の品質確認に使う。
model: opus
effort: xhigh
---

# Slide review

統合記録の雛形は`$CLAUDE_PLUGIN_ROOT/skills/slide-authoring/templates/review-template.json`を使う。placeholderを実際の観測で置き換え、判定はschemaと検証結果に従う。

品質基準は`$CLAUDE_PLUGIN_ROOT/skills/slide-authoring/guidelines/quality-assurance.md`、形式契約は`$CLAUDE_PLUGIN_ROOT/schemas/review.schema.json`、担当別指示は`$CLAUDE_PLUGIN_ROOT/agents/`を正本とする。

CLIはPowerShellで `& "$env:CLAUDE_PLUGIN_ROOT/scripts/run-cli.ps1"`、POSIXで `bash "$CLAUDE_PLUGIN_ROOT/scripts/run-cli.sh"` を使う。以下の `<marp-slide-cli>` はこのlauncherを表す。

このスキルは制作側の進行役が読む。初見担当にはこのスキルや制作側のコンテキストを渡さず、agentが許可する入力だけを渡す。contentとvisualにも個別の担当範囲を割り当て、独立した証跡を残す。

### 初見・内容・視覚の独立レビュー

最初に`audience-reviewer`を新規コンテキストで起動する。渡すのは読者属性・delivery mode・閲覧条件・全ページPNG・fingerprint/attempt/iterationだけ。goal、plan、notes、他レビューは渡さない。初見記録を確定した後、content reviewerへ記録とrequest、plan、根拠を渡し、問いへの答えと実際の読み取りの一致を確認させる。visual reviewerは初見担当と別コンテキストにし、machine QAの`manual_checks`を全件解決する。

- `audience-reviewer`: 完成画像だけで主題・根拠・到達点を読み取り、`audience-review.json`を固定する。
- `content-reviewer`: 聞き手、論理、action title、根拠、仮説、notesを評価し、`content-review.json` を書く。
- `visual-reviewer`: contact sheetでデッキ全体のリズムを確認後、全2倍PNGを1枚ずつ評価し、`visual-review.json` を書く。

reviewerを起動する前に`<marp-slide-cli> prepare-review --root .`を実行し、その`artifact_fingerprint`と`review_attempt`を全reviewerへ渡す。初見・内容・視覚の3結果と、レンダラーが書いた `.slide-work/machine-qa.json` を `$CLAUDE_PLUGIN_ROOT/schemas/review.schema.json` が定めるrubric v4へ統合する。`content-review.json` のhard gates／scoresは`content_review`へ、`visual-review.json` のcontact sheet／page list／hard gates／scores／page findingsは`visual_review`へ写し、issuesとstrengthsは重複を除いてトップレベルへ集約する。中間reviewer用の`reviewer`など、schemaにないkeyを`review.json`へ持ち込まない。content reviewerが`needs_user`なら統合statusも`needs_user`、入力へアクセス不能なら`blocked`にする。

machine QAのpassを手で捏造しない。critical/major、hard gate fail、評価3以下が残る状態をpassにしない。reviewerが実画像を見られない場合は `blocked` とし、自己判定でpassを作らない。

統合後は `<marp-slide-cli> validate-review --root .` で厳密schemaとartifact整合を検証する。

### 必須の修正と再検証

初回レビューから最も影響の大きい問題をまとめて直す。次のrenderを実行する前に、変更対象ページと具体的な理由を `render-manifest.json` の`improvements`へ、次のiteration番号で追記する。レンダラーはそのentryを保持してiterationを進める。全入力を再fingerprintし、全形式を再レンダーし、machine QAと新しい初見コンテキストを含む三系統レビューを再実行する。レビュー後のソース、theme、request、asset変更は古いpassを失効させる。

