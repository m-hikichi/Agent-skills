# marp-slide プラグイン

Claude Code の plugin として配布できる Marp スライド作成支援パッケージです。要件をヒアリングしてスライドを作り、作成した AI とは別の reviewer サブエージェントが批判的に審査し、PDF/PNG までエクスポートします。

レビューでは 10 個のハードゲート（ストーリー 5 + ビジュアル 5）だけを見ます。「まあ悪くない」は fail、「文句のつけようがない」だけが pass。`.slide-work/review.json.status == "pass"` になるまで完了しません。

## 何ができるか

- **要件からスライドを作る**: 聞き手・目的・枚数などを対話で聞き取り、Marp のソースを生成します
- **別の AI に批判的にレビューさせる**: 作成者ではない `reviewer` サブエージェントが、PNG 画像と Markdown の両面からチェックします
- **PDF / PNG / HTML / PPTX で出力する**: レビュー時に生成した PDF/PNG に加え、要求に応じて追加フォーマットも出力できます
- **既定のデザインを引き継げる**: `templates/presentation-starter.md` のデザインリファレンスを土台にして見た目の一貫性を保ちます

## 必要なもの

- Claude Code 1.0.33 以降
- Docker（Marp CLI・Chromium・日本語フォントは Docker イメージ内で動作します。ローカルに Node.js や Marp CLI を入れる必要はありません）

## セットアップ

1. Docker イメージをビルドする（初回のみ）

```bash
cd <path-to-this-repo>/plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

2. plugin をローカルで読み込む

```bash
claude --plugin-dir <path-to-this-repo>/plugins/marp-slide
```

3. Claude Code 内でスキルを呼ぶ

```text
/marp-slide:main
```

`/help` を実行すると `marp-slide` 名前空間の下にスキルが表示されます。

## 使い方

`/marp-slide:main` を実行すると、以下のワークフローで進行します。

```
S1. Gather   : 聞き手・目的・枚数・必須要素などを対話で埋める
S2. Draft    : slides/presentation.md を生成する
S3. Review   : 別の AI（reviewer サブエージェント）が MCP で PDF/PNG を出力し、
               PNG 目視と Markdown 内容の両面で 10 ゲート判定する。fail なら修正して再実行（最大 3 回）
S4. Export   : 最終確認。必要に応じて HTML/PPTX を追加出力する
```

会話の途中で切れても、`.slide-work/` の状態から自動的に再開ポイントを判定します。

## 10 個のレビュー基準

### ストーリー・タイトル品質
- G1. タイトルが topic label ではなく takeaway（結論）になっている
- G2. 冒頭に聞き手のフック／executive summary がある
- G3. 最終スライドに具体的なアクション／判断要求がある
- G4. bullet がタイトルの言い換えではなく独自情報を持つ
- G5. 「必ず入れてほしい内容」（`must_include`）が全て反映されている

### ビジュアル品質
- G6. 全ページの PNG ではみ出し・切れがない
- G7. タイトル除くテキスト 6 行以下、bullet 3 つ以下、各 bullet 2 行以下
- G8. 同じレイアウトが 3 枚以上連続しない
- G9. デフォルトの Marp スタイルではなく custom theme が適用されている
- G10. 実際の枚数が target_slide_count の ±3 枚以内

## 作業ファイル

スキル実行中は `.slide-work/` 以下に状態が作られます。

```text
.slide-work/
|-- request.yaml              # 要件
|-- review.json               # reviewer の判定結果
|-- presentation.pdf          # PDF 出力
|-- preview.html              # HTML プレビュー（要求時）
`-- rendered-pages/
    |-- page-001.png
    |-- page-002.png
    `-- ...
slides/
`-- presentation.md           # Marp ソース（編集対象）
```

## デザインをカスタマイズしたいとき

- `skills/main/templates/presentation-starter.md` の style ブロック・archetype クラスを変えると、全スライドの見た目が変わります
- 既存デッキのデザインを踏襲したい場合は、`request.yaml.design_reference` にそのファイルパスを指定できます

## 補足

- レビューは Markdown ソースだけでなく、レンダリング後の PNG 画像を Read ツールで目視します（視覚的なはみ出しやレイアウト崩れはソースだけでは判定できないため）
- Docker が起動していない状態で実行すると、MCP からの export がエラーになります。Docker Desktop を起動してから試してください
- `.mcp.json` は `claude` を起動した作業ディレクトリ（カレントディレクトリ）を Docker の `/workspace` に mount します。プロジェクトのルートで `claude` を起動してください
