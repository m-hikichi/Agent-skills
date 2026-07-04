# スライド型とレイアウトパターン

各スライドは以下の archetype から 1 つを選び、`<!-- _class: ... -->` で必ず宣言して実装する。
すべての archetype クラスと部品クラスは `templates/presentation-starter.md`（および cyberlinks テンプレート）の style ブロックに定義済みで、**完全なマークアップ見本が同テンプレートの本文にある**。ドラフト時は見本の構造をそのまま使う。

## 共通ルール

- タイトルは takeaway（結論文）にする。40 全角字以内・2 行以内（基準の詳細は SKILL.md）
- 1 スライド 1 メッセージ。タイトルを支えない内容は削るか別スライドへ
- 1 つのリストブロックにつき bullet 3 つ以下、各 bullet 2 行以内
- タイトルを除くテキストは 6 行以下（`scripts/deck-lint.sh` が機械チェックする）
- 本文の行長は 35〜40 全角字を超えない（超えるなら 2 カラム化か分割）
- 箇条書きだけのスライドはデッキ全体の 30% 未満にする
- 窮屈な詰め込みより余白を優先する
- 同一 archetype が 3 枚以上連続しない・全体の 40% を超えない（超えるなら再設計）

## デザイントークン規律（reviewer G12）

- 色・フォント・サイズはテンプレートの CSS 変数（`--c-*` / `--fs-*`）と定義済みクラスだけを使う
- 本文側で **inline style・新しい色コード・未定義クラス・`<style>` ブロックを書かない**
- 強調は `**strong**`（primary 色）と `*em*`（accent 色）の 2 種のみ。em は 1 スライド 1 箇所まで
- 図解は下記の部品（steps / timeline / arch / compare / metrics）で組む。生 SVG や Mermaid は使わない
- 画像サイズを変えたいときは Marp 記法 `![w:400](...)` / `![h:200](...)` を使う

## 部品クラス早見表

| 部品 | 用途 | 備考 |
|------|------|------|
| `.grid-2` / `.grid-3` | 2/3 カラム | 中に `.card` か markdown を置く |
| `.card`（`.filled` / `.emphasis`） | 囲みブロック | h3 見出し + 本文 1〜2 行 |
| `.metrics-row` + `.metric`（`.highlight`） | KPI 2〜4 個の横並び | `.value` `.unit` `.label` で構成 |
| `.big-stat` | 数字 1 つを主役に | `.value` `.unit` `.label` |
| `.steps` + `.step` | プロセス図（矢印は CSS） | 3〜5 ステップ |
| `.timeline` + `.t-item`（`.is-now`） | ロードマップ | 3〜5 マイルストーン |
| `.arch` + `.node`（`.hub`）+ `.arrow` | 構成図 | 3〜6 ノード・1 本の流れ |
| `.compare` + `.col`（`.before` / `.after`） | BEFORE/AFTER 比較 | `.col-label` 必須 |
| `.cta-list` + `.cta` | クロージングのアクション | 担当か期限を必ず書く |
| `.pill`（`.accent`） | 短いラベル | フェーズ名・タグ用 |
| `.small` | 注記・出典 | 出典と時点はここに書く |
| `.icon` + `.i-*` | モノクロピクトグラム | 下記「ピクトグラム」参照 |

## ピクトグラム（.icon）

`<span class="icon i-gear"></span>` の形で `.card` / `.metric` / `.evidence` の先頭に置く。内容と意味が対応するときだけ使い、飾りとして付けない。

- 形はテンプレート定義の `.i-*` 20 種のみ。絵文字・外部画像・生 SVG は使わない（G12 の対象）
- 色は既定（primary）を基本に、暗い背景（`.card.emphasis` / `.metric.highlight`）では `.inverse`、控えめにするなら `.sub`。`.accent` は 1 スライド 1 個まで
- サイズは `.sm`（28px・metric 向き）/ 無指定（42px・card 向き）/ `.lg`（64px）。同じ行・列に並ぶアイコンはサイズと色をそろえ、付けるなら並びの全カードに付ける
- bullet の行頭や文中には置かない

| クラス | 意味 | クラス | 意味 |
|---|---|---|---|
| `i-target` | 目的・ゴール | `i-check` | 完了・承認・メリット |
| `i-chart-up` | 増加・成長 | `i-alert` | リスク・課題・注意 |
| `i-chart-down` | 減少・削減 | `i-idea` | 提案・アイデア |
| `i-clock` | 時間・工数 | `i-search` | 調査・分析 |
| `i-money` | コスト・投資 | `i-shield` | 品質・セキュリティ |
| `i-people` | 体制・チーム | `i-rocket` | 立ち上げ・展開 |
| `i-person` | 担当・顧客 | `i-building` | 会社・組織・部門 |
| `i-gear` | プロセス・システム | `i-calendar` | 日程・期限 |
| `i-database` | データ・基盤 | `i-cycle` | 運用・改善サイクル |
| `i-doc` | 資料・契約 | `i-chat` | ヒアリング・対話 |

## title-hero

- 1 枚目で使う。タイトルも結論を一言で（トピック名の羅列にしない）
- タイトル + サブタイトル + `.meta`（日付・対象）だけに絞る。箇条書き禁止
- タイトル 20 字以内、サブタイトル 40 字以内が目安
- `<!-- _paginate: false -->` を併記する

## agenda-overview

- 聞き手が冒頭で構成を把握したほうがよい場合**のみ**使う（原則は省く）
- 項目 3〜5 個、各項目はラベル + 15 字程度の補足 1 行まで

```markdown
<!-- _class: agenda-overview -->

# 本日は判断に必要な3点に絞って説明します

1. 課題 — 何が起きているか
2. 提案 — どう解決するか
3. 効果と計画 — 投資に見合うか
```

## section-divider

- 7 枚以上のデッキの章区切りに使う。見出しは章ラベルでよい（G1 の対象外）
- `.chapter`（章番号）+ 見出し 15 字以内 + サブライン 50 字以内

```markdown
<!-- _class: section-divider -->

<div class="chapter">01</div>

# 課題

## 章のテーマをサブラインで一言補足する
```

## title-content

- 標準の「タイトル + 主要コンテンツ 1 ブロック」。コンテンツは bullet 3 つ、
  カード群 1 組（2〜3 枚）、表 1 つ、または `.metrics-row` 1 本のいずれか
- hero / divider / 比較ページより視覚的に静かに保つ

## assertion-evidence

- 1 つの主張に根拠 2〜3 個 + 証拠 1 つを添えるときに使う
- 左パネル: bullet 最大 3（タイトルの言い換え禁止）
- 右パネル: `.evidence` の中に `.big-stat` か図 1 つだけ

```markdown
<!-- _class: assertion-evidence -->

# 主張（結論文）

<div class="grid-2">
<div>

- 根拠1
- 根拠2

</div>
<div class="evidence">
<div class="big-stat">
<span class="value">42<span class="unit">%</span></span>
<span class="label">指標名（出典・時点）</span>
</div>
</div>
</div>
```

## two-column-compare

- before/after、案 A vs B の比較専用。3 列目は作らない（3 項目以上は表を使う）
- `.col-label`（BEFORE/AFTER 等）必須。各列 bullet 最大 3、左右対称にする

```markdown
<!-- _class: two-column-compare -->

# 比較の結論をタイトルに書く

<div class="compare">
<div class="col before">
<span class="col-label">BEFORE</span>

- 項目

</div>
<div class="col after">
<span class="col-label">AFTER</span>

- 対になる項目

</div>
</div>
```

## two-column-content

- 比較ではない関連 2 トピックの横並び。`.grid-2` + `.card` で組む
- 各カード: h3 小見出し + bullet 2〜3 または本文 2 行。左右の情報量をそろえる

## process-flow

- 手順・運用モデルの説明。3〜5 ステップ（6 以上は 2 枚に分割）
- 各 `.step`: `.step-no` + h3 見出し（5 字前後） + 説明 1 行（省略可）

```markdown
<!-- _class: process-flow -->

# プロセスの結論をタイトルに書く

<div class="steps">
<div class="step">
<span class="step-no">1</span>

### 見出し

<p>説明1行</p>
</div>
<!-- .step を 3〜5 個 -->
</div>
```

## timeline-roadmap

- マイルストーン・展開フェーズの説明。3〜5 個
- 各 `.t-item`: `.pill`（フェーズ名） + h3 + 説明 1 行。現在フェーズだけ `.is-now` + `.pill.accent`

## big-number

- 1 つの数字そのものがメッセージのときに使う（複数の数字は `.metrics-row`）
- `.big-stat`（`.value` + `.label`）+ `.stat-insight` 1 行。数字の周囲に余白を残す
- 未実測の数字には「要確認」「仮説」ラベルを必ず併置する

## architecture-diagram

- システム構成・コンポーネント関係。`.arch` に `.node` 3〜6 個 + `.arrow`
- 中心要素は `.node.hub`。ノード補足は `<span>` 1 行以内。補足は `.arch-note` に

## quote-callout

- 顧客の声・経営層の引用・原則の提示。引用は 3 行以内（長ければ要約してから引用）
- blockquote + `.quote-attr`（出所） + `.quote-insight`（解釈 1〜2 行）

## closing-next-action

- 最終スライド。`.cta-list` にアクション 2〜4 個、**各アクションに担当か期限を必ず書く**
- 「ご清聴ありがとうございました」で終わらない（reviewer G3 が fail にする）

```markdown
<!-- _class: closing-next-action -->

# 本日ご判断いただきたいこと

<div class="cta-list">
<div class="cta">
<span class="cta-no">1</span>
<div class="cta-body">

**アクション（太字1行）**
<span class="cta-meta">期限｜担当</span>

</div>
</div>
<!-- .cta を 2〜4 個 -->
</div>
```

## archetype 選択ガイド

| 伝えたいこと | 第一候補 | 代替候補 |
|-------------|---------|---------|
| 1つの結論とその根拠 | assertion-evidence | title-content |
| 2つの選択肢の比較 | two-column-compare | — |
| 関連する2つのトピック | two-column-content | title-content + .grid-2 |
| 手順やプロセス | process-flow | timeline-roadmap |
| 時系列の計画 | timeline-roadmap | process-flow |
| 1つの印象的な数字 | big-number | assertion-evidence |
| 3〜4つのKPI | title-content + .metrics-row | big-number（1つに絞る） |
| 引用や原則 | quote-callout | title-content |
| 3つ以上の項目の比較 | title-content + 表 | two-column-compare（2項目に絞る） |
| システム構成 | architecture-diagram | process-flow |

### 避けるべき選択

- bullet が 4 つ以上 → archetype が合っていない。分割するかカード・グリッドに変換
- 全スライド title-content → 単調。assertion-evidence / big-number / 比較を織り交ぜる
- 比較が 3 列以上 → 表を使う
- プロセスが 6 ステップ以上 → 2 枚に分割するか、概要と詳細に分ける
- `.big-stat` と `.metrics-row` の同一スライド混在 → どちらか一方に統一

## 視覚レビューの注意

- Markdown 上で問題なく見えても、レンダリング後の PDF/PNG でははみ出すことがある。危うければ reviewer に渡る前に分割する
- カード間でテキスト量が不均衡（1 枚は 3 行、別の 1 枚は 1 行）なら情報量をそろえる
- grid の最後のセルだけ空になるなら、列数を変えるか内容を再構成する
