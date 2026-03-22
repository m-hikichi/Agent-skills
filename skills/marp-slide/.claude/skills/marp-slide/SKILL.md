---
name: marp-slide
description: Marp（Markdown Presentation Ecosystem）を使ったスライド資料の作成・変換・エクスポートを支援するスキル。Markdownからプレゼンテーションスライドを生成し、PDF・PPTX・HTMLへの出力まで行う。以下のような依頼で必ず使用すること：「スライドを作って」「プレゼン資料を作成して」「発表資料を作って」「Marpでスライド作って」「このMDをスライドにして」「スライドをPDFにして」「プレゼンをエクスポートして」「報告資料を作って」「LT資料を作りたい」。また、「marp」「スライド」「プレゼン」「発表」「プレゼンテーション」「報告会」「報告資料」「slide」「deck」といったキーワードが含まれる依頼でも必ずこのスキルを参照すること。勉強会の資料作成、社内プレゼン、技術LT、提案書スライド、プロジェクト報告会、進捗報告、振り返り発表など、スライド形式の資料が必要な場面全般で活用する。
---

# Marp スライド作成スキル

Marp（Markdown Presentation Ecosystem）を使って、Markdownからプロフェッショナルなスライドを作成するスキル。
ユーザーの目的に合わせたテーマ選択、構成提案、エクスポートまでをワンストップで支援する。

## このスキルの最重要原則：「わかりやすさ」がすべてに優先する

スライドの価値は、見た目の美しさでもMarpの機能を使いこなすことでもなく、**聞き手が内容を理解できるかどうか**で決まる。デザインやレイアウトはあくまで「わかりやすさ」を支える手段であり、目的ではない。

このスキルでは、以下の優先順位で判断する：
1. **内容がわかりやすいか**（最優先）
2. 構成が論理的で流れがあるか
3. 対象者に合った粒度・用語になっているか
4. 視覚的に読みやすいか

## Marpとは

MarpはMarkdownでスライドを書けるエコシステム。スライド間は `---` で区切り、YAML形式のディレクティブでテーマやレイアウトを制御する。コードとしてバージョン管理でき、テキストベースなので差分も追いやすい。

## 環境準備

このスキルでは、Marp CLI を Docker コンテナ内で動かす MCP サーバーを使用する。
スライド作成を始める前に、MCP サーバー `marp` が利用可能か確認する。

MCP サーバーが提供するツール:
- `marp_export` — Marp Markdown を HTML / PDF / PPTX にエクスポート
- `marp_check` — Marp Markdown のバリデーション（frontmatter、HTML タグ、テスト出力）

MCP サーバーが利用できない場合は、Docker イメージのビルドが必要な旨をユーザーに案内する。

## 実行契約

このスキルは状態ファイルを使って進行を管理する。会話の雰囲気で判断せず、ファイルに記録された状態に基づいて次のアクションを決定する。

### 状態ファイル

作業開始時に `.slide-work/` ディレクトリを作成し、以下の3ファイルで状態を管理する。

#### `.slide-work/request.yaml` — ヒアリング結果

ヒアリングで得た情報を構造化して記録する。必須項目が未充足なら `missing_required` に記録し、推測して進めず、質問すべき項目だけをユーザーに確認する。

```yaml
title:
topic:
audience:
audience_knowledge:
presentation_context:
goal:
target_slide_count:
output_formats: []
design_reference:
must_include: []
nice_to_have: []
source_materials: []
assumptions: []
missing_required: []
open_questions: []
approval:
  outline_approved: false
  draft_approved: false
```

**必須項目**: `topic`, `audience`, `audience_knowledge`, `presentation_context`, `goal`, `target_slide_count`, `output_formats`
これらのいずれかが空の場合、`missing_required` にその項目名を追加し、ユーザーに確認する。

#### `.slide-work/outline.yaml` — 構成案

構成案を機械的に扱える形で保存する。ユーザーの承認前に必ずこのファイルを作成する。

```yaml
intent: ""
slide_count: 0
slides:
  - no: 1
    title: ""
    purpose: ""
review_notes: []
```

#### `.slide-work/review.json` — レビュー結果と完了判定

ドラフト作成後は毎回このファイルを**上書き**する。`review.json` は「現在の `request.yaml` / `outline.yaml` / `slides/presentation.md` に対する最新レビュー結果」を表す唯一の完了判定ファイルであり、`status` が `pass` かつ検証成功のときだけ完了候補になる。

```json
{
  "status": "missing_info",
  "reviewed_at": "",
  "missing_required": [],
  "issues": [],
  "questions_for_user": [],
  "exact_fix_instructions": [],
  "last_checked_files": [
    ".slide-work/request.yaml",
    ".slide-work/outline.yaml",
    "slides/presentation.md"
  ],
  "validation": {
    "marp_check": {
      "status": "not_run",
      "details": ""
    },
    "exports": [
      {
        "format": "html",
        "output": ".slide-work/preview.html",
        "status": "not_run",
        "details": ""
      }
    ]
  }
}
```

`status` の値:
- `pass` — 最新ドラフトに対するレビュー、`marp_check`、HTML プレビュー、および要求された出力形式のエクスポート検証がすべて成功。完了候補
- `fail` — 問題あり。`exact_fix_instructions` に従って修正し、**同じファイル群に対して再レビュー**が必要
- `missing_info` — 必須情報不足またはユーザー確認が必要。`questions_for_user` をそのままユーザーに確認し、推測で進めない

### 責務分担

- `SKILL.md` — 状態遷移と次のアクションを定義する。`pass` / `fail` / `missing_info` を読んでどう動くかはここに従う
- `.claude/agents/slide-reviewer.md` — 1回分のレビュー処理を定義する。何を読み、何を検証し、どの形式で `review.json` を上書きするかはここに従う
- `.claude/settings.json` — いつ review を自動再実行するか、いつ終了をブロックするかを定義する

### 進行ルール

1. 作業開始時に `.slide-work/request.yaml` を作成する
2. 必須項目が未充足なら `missing_required` に記録し、推測で進めない
3. 不足情報がある場合、質問すべき項目だけを `open_questions` に記録してユーザーに確認する
4. 構成案は `.slide-work/outline.yaml` に保存し、ユーザー承認後に `approval.outline_approved: true` にする
5. `slides/presentation.md`、`.slide-work/request.yaml`、`.slide-work/outline.yaml` を更新したら、hook によってレビューが再実行される前提で進める。ただし hook の結果は必ず `.slide-work/review.json` を読み返して確認し、更新されていなければ `slide-reviewer` を手動で呼び出す
6. `review.json` の `status` が `fail` の間は完了扱いにしない。`exact_fix_instructions` を順に反映し、再レビューする
7. `review.json` の `status` が `missing_info` の場合は、`questions_for_user` をユーザーに確認して待つ。推測で埋めて進まない
8. `review.json` の `status` が `pass` でも、`validation.marp_check.status` が `pass` であり、HTML プレビューと `request.yaml.output_formats` の各形式の export が成功していなければ完了扱いにしない
9. レビュー時の検証は `slide-reviewer` が担当する。毎回 `marp_check(source: "slides/presentation.md")` と HTML プレビュー export を実行し、さらに `request.yaml.output_formats` に含まれる各形式を `marp_export` で検証する

### レビュー観点（slide-reviewer が評価）

以下の観点でレビューを行い、結果を `review.json` に記録する:

1. **必須情報の充足** — `request.yaml` の必須項目がすべて埋まっているか
2. **対象者適合** — 対象者の前提知識に合った粒度・用語になっているか
3. **ゴール整合** — プレゼンのゴールに沿った内容になっているか
4. **1スライド1メッセージ** — 各スライドが1つのメッセージに絞られているか
5. **論理的な流れ** — スライド間のつながりが自然か
6. **はみ出しリスク** — テキスト量が多すぎるスライドはないか
7. **用語の難易度** — 専門用語が対象者にとって難しすぎ／易しすぎないか
8. **エクスポート可否** — Marp CLI でエラーなくエクスポートできるか

## スライド作成のワークフロー

**このワークフローの核心は「ユーザーとの反復的なやり取り」にある。** 一度で完璧なスライドを作ろうとせず、十分な情報を集めてから構成を提案し → 承認を得てからドラフトを作り → フィードバックをもらい → 改善する、を繰り返すことで、本当にわかりやすいスライドに仕上げていく。

### 1. ヒアリング — 十分な情報が集まるまで粘り強く聞く

スライドの質は、ここで集める情報の質で決まる。ユーザーは忙しかったり、何を伝えればいいかわからなかったりして、最初の回答が断片的になることが多い。それは普通のこと。焦ってスライドを作り始めず、根気強く情報を集めることが最も重要なステップ。

#### 必ず確認する項目

- **テーマ/話題**: 何についてのスライドか
- **対象者**: 誰に向けたプレゼンか（社内、技術者、経営層、一般向けなど）
- **対象者の前提知識**: どこまで知っている人たちか（これが内容の粒度を決める最重要情報）
- **発表の場面**: どのような場で発表するか（勉強会、LT、プロジェクト報告会、提案、研修など）
- **伝えたいこと**: このプレゼンを聞いた人に何を持ち帰ってほしいか（ゴール）
- **スライド枚数の目安**: 短めの発表か、じっくりした説明か
- **出力形式**: プレビュー（HTML）、PDF、PPTXのどれが必要か
- **デザインの参考元**: 既存のMarpスライドやPPTXファイルがあればそれを参考にする（なければビルトインテーマから選択）

#### ヒアリングの進め方

一度に全部聞くとユーザーの負担が大きい。まずは最も重要な項目（テーマ、対象者、ゴール）を聞き、回答を受けて深掘りしていく。

**ユーザーが十分な情報をくれない場合の対応：**

ユーザーが「スライド作って」とだけ言ってきたり、質問に対して最低限の情報しか返さないケースは珍しくない。その場合でも、推測で作り始めてはいけない。わかりやすいスライドを作るには情報が必要だと伝え、丁寧に、しかし粘り強く聞き続ける。

例：
- ユーザー：「Dockerについてのスライド作って」
- → 「Dockerのスライドですね！いくつか教えてください。まず、このプレゼンを聞くのはどんな方ですか？（エンジニア？非エンジニア？）」
- ユーザー：「エンジニアです」
- → 「ありがとうございます。Docker経験者が多いですか？それとも初めて触る人もいそうですか？」
- → 「このプレゼンで一番伝えたいことは何ですか？（例：Dockerの導入メリット、具体的な使い方、チームへの展開方法など）」

このように、一問一答で少しずつ情報を引き出す。ユーザーが面倒くさそうにしていても、「良い資料を作るために確認させてください」と前置きして聞く。

**「もう十分」の判断基準：**

`.slide-work/request.yaml` の `missing_required` が空になったら、構成の設計に進んでよい。具体的には以下の必須項目がすべて埋まっていること：

1. **誰に** (`audience` + `audience_knowledge`): 対象者とその前提知識レベルが具体的にわかっている
2. **何を** (`topic` + `presentation_context`): スライドに盛り込むべき具体的な内容が揃っている
3. **なぜ** (`goal`): このプレゼンのゴール（聞き手にどうなってほしいか）が明確になっている
4. **どれくらい** (`target_slide_count` + `output_formats`): 分量と出力形式が決まっている

逆に、`missing_required` に項目が残っているままスライドを作り始めると、的外れな資料になるリスクが高い。必ず `request.yaml` を更新してから次のステップに進むこと。

### 2. 対象者に合わせた内容の調整

対象者の前提知識に応じて、スライドに載せる内容の粒度を大きく変える。同じテーマでも、聞き手によってスライドの中身はまったく違うものになる。

**前提知識がある人向け**（例：エンジニア向けに技術トピックを話す場合）
- 基礎概念の説明は省略し、「なぜ・どう使うか」に集中する
- 用語はそのまま使ってよい（噛み砕くと逆にまどろっこしくなる）
- コード例や具体的な設定値など、実践的な情報を増やす

**前提知識がない人向け**（例：非エンジニアにIT技術を説明する場合）
- 専門用語は必ず平易な言葉に置き換えるか、初出時に短い説明を添える
- 「なぜそれが必要か」から入り、身近なたとえ話で概念を伝える
- 技術的な詳細は省き、メリットや影響に焦点を当てる

**混合オーディエンス**（知識レベルがバラバラな場合）
- 冒頭で前提を揃える短いスライド（1-2枚）を入れつつ、深い話もカバーする
- 「ご存知の方も多いと思いますが」のようなクッション表現を活用する

### 3. スライド構成の設計

内容を整理し、発表の場面に応じた構成を提案する。

#### 一般的なプレゼンの構成

1. **タイトルスライド** — テーマ名、発表者、日付
2. **アジェンダ** — 全体の流れを示す（5枚以上の場合）
3. **本編スライド** — 1スライド1メッセージが原則
4. **まとめ** — 要点の整理
5. **Q&A / 参考資料**（必要に応じて）

#### プロジェクト報告会の構成

プロジェクト報告は「何をしたか」だけでなく「それが何を意味するか」を伝えることが重要。聞き手が知りたいのは作業の羅列ではなく、プロジェクトの健全性と今後の見通し。

1. **タイトル** — プロジェクト名、報告期間、発表者
2. **エグゼクティブサマリー** — 結論を最初に。プロジェクトの状態を一言で伝える（順調/要注意/遅延など）
3. **進捗状況** — 計画と実績の対比。数値や図表があると説得力が増す
4. **成果・達成事項** — 報告期間中に完了したこと
5. **課題・リスク** — 現在の課題と、それに対するアクション
6. **今後の予定** — 次の期間で何をするか
7. **相談事項**（あれば） — 判断が必要なことや支援依頼

#### 技術LT / 勉強会の構成

短時間で印象に残すことが大事。冒頭で聞き手の興味を掴む。

1. **タイトル** — キャッチーに。「○○してみた」「○○を解決した話」
2. **きっかけ/問題提起** — なぜこの話をするのか、どんな課題があったか
3. **解決策/やったこと** — 具体的なアプローチ
4. **デモ/結果** — 動くものや数値で見せる
5. **学び/まとめ** — 持ち帰ってほしいポイント

### 4. わかりやすいスライドを作るための原則

スライドの「わかりやすさ」は感覚ではなく、具体的なテクニックで実現できる。以下を意識してスライドを作成する。

#### 構成のテクニック

- **結論ファースト**: 各スライドの見出しに結論を書く。「売上分析」ではなく「売上は前年比120%で推移」。聞き手はスライドを見た瞬間に要点を掴める
- **1スライド1メッセージ**: 伝えたいことを1つに絞る。2つ以上ある場合はスライドを分ける
- **「だから何？」テスト**: すべてのスライドに対して「だから何？（So What?）」と自問する。答えられないスライドは、メッセージが不明確か、不要な可能性がある
- **ストーリーの流れ**: 問題提起 → 原因分析 → 解決策 → 結果、のように論理的な流れを作る。スライド間のつながりが自然になるよう心がける

#### 表現のテクニック

- **具体的に書く**: 「大幅に増加」ではなく「前月比35%増加」。数値・固有名詞・具体例で語る
- **箇条書きは5項目以内**: 超える場合はグルーピングするか、スライドを分割する
- **たとえ話を活用する**: 抽象的な概念は、聞き手にとって身近なものにたとえる。「コンテナはアプリの引っ越し用の段ボール箱のようなもの」
- **専門用語のコントロール**: 対象者に合わせて、使う/噛み砕く/省略する を判断する

#### 視覚のテクニック

- **余白を恐れない**: 情報を詰め込むより、空間に余裕があるほうが読みやすい
- **対比で見せる**: Before/After、従来/新方式、問題/解決 のように対比構造を使うと理解しやすい
- **アウトラインアイコンで視覚的に伝える**: 文字だけの箇条書きは単調で読みにくい。Material Symbols や Font Awesome などのアウトラインアイコンを使うと、項目の意味がひと目で伝わり、プロフェッショナルな見た目になる。詳しい使い方は後述の「アウトラインアイコンの活用」セクションを参照
- **コンテンツのはみ出しを絶対に防ぐ**: Marpはテキスト量が増えると自動縮小されるが、さらに多いと**スライドの枠外にはみ出して見切れてしまう**。これは資料として致命的な問題。以下のルールを徹底する：
  - 1スライドの箇条書きは**最大5項目**、各項目は**1-2行以内**
  - テーブルは**最大6行程度**まで。超える場合はスライドを分割
  - コードブロックは**15行以内**。超える場合は重要な部分だけ抜粋
  - テキスト量が多くなりそうだと感じたら、迷わずスライドを分ける。「少なすぎ」より「はみ出し」のほうがはるかに悪い

### 5. Markdownの記述

#### 基本構造

```markdown
---
marp: true
theme: default
paginate: true
html: true
header: 'プレゼンタイトル'
footer: '© 2026 Author'
style: |
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined');
  section {
    font-family: 'Noto Sans JP', sans-serif;
  }
  .icon {
    font-family: 'Material Symbols Outlined';
    font-size: 1.2em;
    vertical-align: middle;
    margin-right: 0.3em;
    font-variation-settings: 'FILL' 0, 'wght' 300;
  }
---

# タイトル

サブタイトル
発表者名 / 日付

---

## アジェンダ

1. はじめに
2. 本題
3. まとめ

---

## スライドの内容

- <span class="icon">check_circle</span> ポイント1
- <span class="icon">warning</span> ポイント2
- <span class="icon">arrow_forward</span> ポイント3

<!-- 発表者ノート：ここに補足説明を書く -->

---
```

#### よく使うディレクティブ

フロントマターに書くグローバル設定：

| ディレクティブ | 説明 | 例 |
|---|---|---|
| `marp: true` | Marpスライドとして認識させる（必須） | `marp: true` |
| `theme` | テーマの選択 | `theme: default`, `theme: gaia`, `theme: uncover` |
| `paginate` | ページ番号の表示 | `paginate: true` |
| `header` | ヘッダーテキスト | `header: 'My Talk'` |
| `footer` | フッターテキスト | `footer: '© 2026'` |
| `size` | スライドサイズ | `size: 16:9`（デフォルト）, `size: 4:3` |
| `backgroundColor` | 背景色 | `backgroundColor: '#f0f0f0'` |
| `color` | テキスト色 | `color: '#333'` |
| `style` | カスタムCSS | 下記参照 |

個別スライドに書くローカルディレクティブ（`<!-- _directive: value -->` 形式）：

| ディレクティブ | 説明 |
|---|---|
| `<!-- _class: lead -->` | スライドにCSSクラスを適用 |
| `<!-- _backgroundColor: #000 -->` | そのスライドだけ背景色を変更 |
| `<!-- _color: #fff -->` | そのスライドだけテキスト色を変更 |
| `<!-- _paginate: false -->` | そのスライドだけページ番号を非表示 |
| `<!-- _header: '' -->` | そのスライドだけヘッダーを非表示 |

#### 画像の活用

```markdown
<!-- 背景画像 -->
![bg](./images/background.jpg)

<!-- 背景画像（右半分に表示） -->
![bg right](./images/photo.jpg)

<!-- 背景画像（左40%に表示） -->
![bg left:40%](./images/photo.jpg)

<!-- 背景画像（暗くする） -->
![bg brightness:.5](./images/dark-bg.jpg)

<!-- 通常の画像（サイズ指定） -->
![w:400](./images/diagram.png)
```

#### テーマの選び方

Marpには3つのビルトインテーマがある。用途に応じて使い分ける：

- **default** — シンプルで万能。迷ったらこれ。白背景にきれいなタイポグラフィ
- **gaia** — 色使いが豊かで目を引く。`lead` クラスでインパクトのあるタイトルスライドが作れる
- **uncover** — モダンでミニマル。テキスト中心のプレゼンに向いている

カスタムCSSでさらにカスタマイズもできる：

```markdown
---
marp: true
theme: default
style: |
  section {
    font-family: 'Noto Sans JP', sans-serif;
  }
  h1 {
    color: #2563eb;
  }
  section.lead h1 {
    font-size: 2.5em;
  }
---
```

#### アウトラインアイコンの活用

文字だけのスライドは単調で、項目の性質を瞬時に判別しにくい。Material Symbols（Google）のアウトラインアイコンを使うと、視覚的に情報が整理され、プロフェッショナルな印象になる。

Marpで使うにはフロントマターの `style` でWebフォントを読み込む。`html: true` をフロントマターに設定する必要がある。エクスポートは MCP サーバーの `marp_export` ツールで行う。

**セットアップ（フロントマターに追加）：**

```markdown
---
marp: true
html: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined');
  .icon {
    font-family: 'Material Symbols Outlined';
    font-size: 1.2em;
    vertical-align: middle;
    margin-right: 0.3em;
    font-variation-settings: 'FILL' 0, 'wght' 300;
  }
---
```

**スライド内での使い方：**

```markdown
## プロジェクト状況

- <span class="icon">check_circle</span> ユーザー認証機能：リリース完了
- <span class="icon">warning</span> バックエンドAPI：2週間遅延
- <span class="icon">schedule</span> β版リリース：3月末予定

## 今後のアクション

- <span class="icon">person_add</span> バックエンド要員の追加採用
- <span class="icon">bug_report</span> 外部API連携の仕様変更対応
- <span class="icon">rocket_launch</span> 3月末にβ版リリース
```

**よく使うアイコン名（Material Symbols）：**

| 用途 | アイコン名 | 表示 |
|---|---|---|
| 完了・成功 | `check_circle` | チェックマーク |
| 注意・警告 | `warning` | 三角の警告 |
| エラー・失敗 | `cancel` | バツ印 |
| スケジュール | `schedule` | 時計 |
| 重要 | `priority_high` | 感嘆符 |
| アイデア | `lightbulb` | 電球 |
| 人・チーム | `group` | 人のグループ |
| 設定・技術 | `settings` | 歯車 |
| データ・分析 | `analytics` | グラフ |
| 目標・ゴール | `flag` | 旗 |
| 次のステップ | `arrow_forward` | 右矢印 |
| セキュリティ | `shield` | 盾 |
| ドキュメント | `description` | 文書 |
| ビルド・構築 | `build` | ハンマー |

アイコン名の全一覧は https://fonts.google.com/icons で検索できる。

**Font AwesomeやRemix Iconも使用可能：**

CDNのURLを変えれば他のアイコンライブラリも使える。ただし、Material Symbolsが最も軽量で種類が豊富なので、特に理由がなければMaterial Symbolsを使う。

#### HTML/CSSを活用した見やすいレイアウト

Marp は `html: true` を指定することでHTML タグが使える。これを活用すると、Markdownだけでは難しい視覚的に構造化されたレイアウトが実現できる。

**2カラムレイアウト：**

```markdown
<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2em;">
<div>

### 従来の方法
- 手動でサーバーに設定
- 環境ごとに差異が発生
- 再現性が低い

</div>
<div>

### Docker導入後
- Dockerfileでコード化
- どこでも同じ環境
- ワンコマンドで起動

</div>
</div>
```

**カード型レイアウト（成果やポイントを並べる場合）：**

```markdown
<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1em; margin-top: 1em;">
<div style="background: #f0f7ff; border-radius: 8px; padding: 1em; border-left: 4px solid #3b82f6;">

**<span class="icon">check_circle</span> 認証機能**
ログイン・ログアウトを本番環境にリリース済み

</div>
<div style="background: #f0fdf4; border-radius: 8px; padding: 1em; border-left: 4px solid #22c55e;">

**<span class="icon">dashboard</span> ダッシュボード**
進捗状況を一目で把握できる画面を構築

</div>
<div style="background: #fefce8; border-radius: 8px; padding: 1em; border-left: 4px solid #eab308;">

**<span class="icon">build</span> CI/CD**
品質チェックとリリースを自動化

</div>
</div>
```

**ステータスバッジ（状況を色で表現）：**

```markdown
<span style="background: #dcfce7; color: #166534; padding: 2px 10px; border-radius: 12px; font-size: 0.85em;">◉ 順調</span>
<span style="background: #fef9c3; color: #854d0e; padding: 2px 10px; border-radius: 12px; font-size: 0.85em;">◉ 要注意</span>
<span style="background: #fecaca; color: #991b1b; padding: 2px 10px; border-radius: 12px; font-size: 0.85em;">◉ 遅延</span>
```

これらのHTML/CSSパターンを積極的に使い、テキストだけの平坦なスライドにならないようにする。ただし装飾が目的化しないよう、あくまで「わかりやすさ」のために使うこと。

### 6. デザインの参考元を活用する

ユーザーが「このデザインで作って」「前のプレゼンと同じ雰囲気にして」と言った場合、既存のファイルからデザイン要素を抽出して再現する。

#### 既存のMarpスライドを参考にする場合

1. 参考となる `.md` ファイルを読み込む
2. フロントマターから `theme`、`style`、`backgroundColor`、`color` などのデザイン設定を抽出する
3. ローカルディレクティブ（`<!-- _class: ... -->` など）のパターンも確認する
4. 抽出したデザイン設定を新しいスライドのフロントマターとスタイルに適用する

#### PPTXファイルを参考にする場合

PPTXファイルからデザインの意図を読み取り、Marpの `style` ディレクティブで再現する：

1. PPTXファイルを読み込み、以下の要素を分析する：
   - カラーパレット（背景色、テキスト色、アクセントカラー）
   - フォントファミリーとサイズの傾向
   - レイアウトパターン（タイトルの位置、余白の取り方）
   - 装飾要素（区切り線、枠、影など）
2. 分析結果をMarpのカスタムCSS（`style` ディレクティブ）に変換する
3. 完全な再現は難しいため、「色合い」「雰囲気」「レイアウトの方向性」を優先的に反映する
4. 再現しきれない要素があればユーザーに伝え、代替案を提案する

**例：PPTXから抽出したデザインの適用**

```markdown
---
marp: true
theme: default
style: |
  /* PPTXのカラーパレットを再現 */
  section {
    background-color: #1a1a2e;
    color: #eaeaea;
    font-family: 'Noto Sans JP', 'Segoe UI', sans-serif;
  }
  h1, h2 {
    color: #e94560;
    border-bottom: 2px solid #e94560;
    padding-bottom: 0.3em;
  }
  section.lead {
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
    text-align: center;
  }
  section.lead h1 {
    color: #ffffff;
    border-bottom: none;
    font-size: 2.5em;
  }
---
```

#### デザインの指定がない場合

ユーザーがデザインの参考元を指定していない場合は、Marpのビルトインテーマ（default / gaia / uncover）から用途に合ったものを選ぶ。無理にカスタムCSSを書く必要はない。

### 7. 既存Markdownからの変換

ユーザーが既存のMarkdownドキュメントをスライドにしたい場合：

1. まず元のMarkdownを読み込む
2. 内容を分析し、スライドとしての区切りポイントを特定する
3. 以下のルールで変換する：
   - `# 見出し1` → 新しいスライドのタイトル
   - `## 見出し2` → スライド内のセクション見出し、または新しいスライドの区切り
   - 長い段落 → 箇条書きに要約
   - コードブロック → そのまま維持（Marpはシンタックスハイライト対応）
   - 画像 → Marpの画像記法に変換
4. Marpのフロントマターを追加
5. `---` でスライドを区切る

変換時に情報量が多すぎる場合は、内容を削らずに複数スライドに分割する。

### 8. 構成の提案と承認 — Markdownを書く前に必ず合意を取る

ヒアリングで十分な情報が集まったら、**いきなりMarkdownを書き始めてはいけない**。まずスライドの構成案（どんなスライドを何枚、どんな順番で作るか）をテキストで提示し、ユーザーの承認を得る。

#### 構成案の提示フォーマット

以下のような形式で、各スライドのタイトルと要旨を一覧にして見せる：

```
【構成案】全8枚

1. タイトル：「プロジェクトX 進捗報告」— 報告者、日付
2. サマリー：プロジェクト全体の状態を一言で（順調）
3. 進捗状況：計画と実績を対比した表（マイルストーン3つ）
4. 今期の成果：完了した主要タスク3つ
5. デモ画面：新しく実装した管理画面のスクリーンショット
6. 課題とリスク：現在の2つの課題とそれぞれの対応策
7. 今後の予定：次の1ヶ月でやること
8. 相談事項：追加リソースの承認依頼
```

構成案を出すとき、なぜこの構成にしたかの意図も簡潔に添える。「聞き手が非エンジニアの部長クラスとのことなので、技術的な詳細は省いて、プロジェクトの状態と判断が必要な事項に絞りました」のように。

#### 承認を得るまでの流れ

1. 構成案を `.slide-work/outline.yaml` に保存する
2. 構成案をテキストでユーザーに提示する
3. ユーザーから「これでいい」「OKです」といった承認をもらう
4. 承認を得たら `.slide-work/request.yaml` の `approval.outline_approved` を `true` に更新する
5. 修正の要望があれば、`outline.yaml` を修正して再度提示する
6. **`approval.outline_approved: true` になってから**、Marp形式のMarkdownを書き始める

ユーザーが構成案に対して「いいよ」とだけ返した場合はそのまま進める。具体的な修正指示があれば反映する。ただし、構成に関するフィードバックなしに「もうスライド作って」と言われた場合は、構成案を承認したものとして進めてよい。

### 9. ドラフト作成とレビューの改善サイクル

構成の承認を得たら、Marp形式のMarkdownでドラフトを作成する。一度書いたら終わりではなく、ユーザーと何度もやり取りを重ねて、わかりやすさを磨き上げていく。

#### レビューの進め方

1. **ドラフトを作成する**: 承認された構成（`outline.yaml`）に沿って `slides/presentation.md` を書く
2. **最新の review.json を必ず得る**: 通常は `settings.json` の hook が `slide-reviewer` 相当のレビューを自動実行して `.slide-work/review.json` を更新する。`review.json` が存在しない、更新されていない、または内容が古そうな場合は、`slide-reviewer` を手動で呼び出して最新化する
3. **レビュー結果に基づいて分岐する**:
   - `status: "missing_info"` → `questions_for_user` をそのままユーザーに確認し、回答が得られるまで止まる
   - `status: "fail"` → `exact_fix_instructions` を順に反映して `slides/presentation.md` などを修正し、**必ず** 2 に戻って再レビューする
   - `status: "pass"` → ユーザーにドラフトを提示してフィードバックを求める
4. **ユーザー指摘後も同じループを続ける**: ユーザーのフィードバックを受けて `slides/presentation.md`、`request.yaml`、`outline.yaml` のいずれかを更新したら、pass が一度出ていてもそこで終わらず、必ず 2 に戻って再レビューする
5. **完了条件**: 最新の `review.json` が `status: "pass"` で、`validation.marp_check.status == "pass"` かつ HTML プレビューと要求形式の export が成功し、さらにユーザーが「これでいい」と言ったときだけ、`request.yaml` の `approval.draft_approved` を `true` に更新する

#### レビュー結果の読み方

`review.json` の各フィールドは以下の意味を持つ：

- `status`: `pass` | `fail` | `missing_info` — 全体の判定
- `reviewed_at`: そのレビューが実行された時刻。hook はこれを見てレビューの鮮度を判断する
- `missing_required`: 不足している必須情報のリスト
- `issues`: 検出された問題のリスト（対象者適合、ゴール整合、はみ出しリスク、検証失敗など）
- `questions_for_user`: ユーザーに確認すべき質問のリスト
- `exact_fix_instructions`: 自動修正可能な具体的な修正指示のリスト
- `last_checked_files`: レビュー時に確認したファイルのリスト
- `validation.marp_check`: `marp_check` の結果
- `validation.exports`: HTML プレビューおよび要求形式ごとの `marp_export` 結果

### 10. エクスポート

レビュー段階では、`slide-reviewer` が **毎回** `marp_check` と export 検証を実行する。ここでのエクスポート工程は、最新の `review.json` が `pass` になったあとに利用者へ渡す成果物を再出力したり、出力先を変えたりするための工程として扱う。

MCP サーバーの `marp_export` ツールを使ってスライドを出力する：

```
# HTMLとしてプレビュー（ブラウザで開ける）
marp_export(source: "slides/presentation.md", format: "html")

# PDFとして出力
marp_export(source: "slides/presentation.md", format: "pdf")

# PPTXとして出力
marp_export(source: "slides/presentation.md", format: "pptx")

# 出力ファイル名を指定
marp_export(source: "slides/presentation.md", format: "pdf", output: "slides/presentation.pdf")
```

`marp_check` と HTML プレビュー + 要求形式の export 検証は、完了判定の一部として `slide-reviewer` が実行する。ここで追加の `marp_export` を実行するのは、別パスへの保存や最終納品ファイルの再生成が必要なときだけでよい。

## ファイルの保存先

スライドのMarkdownファイルは、ユーザーが指定した場所に保存する。指定がなければ、カレントディレクトリに `slides/` ディレクトリを作成して保存を提案する。

```
slides/
├── presentation.md    # スライド本体
└── images/            # 使用する画像（あれば）
```
