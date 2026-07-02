# marp-slide プラグイン

Claude Code の plugin として配布できる Marp スライド作成支援パッケージです。要件をヒアリングし、ストーリーボード（各スライドのアクションタイトル）を先に固めてからスライドを作り、作成した AI とは別の reviewer サブエージェントが批判的に審査し、PDF/PNG までエクスポートします。

レビューでは 12 個のハードゲート（ストーリー 6 + ビジュアル 6）だけを見ます。「まあ悪くない」は fail、「文句のつけようがない」だけが pass。現在の `slides/presentation.md` と一致する `.slide-work/review.json.status == "pass"` になるまで完了しません。

## 何ができるか

- **要件からスライドを作る**: 聞き手・目的・枚数などを対話で聞き取り、Marp のソースを生成します
- **ストーリーを先に設計する**: ピラミッド原理 + SCQA でストーリーボード（全スライドのアクションタイトル）を先に確定し、タイトルだけで話が通る「横のロジック」を検証してから本文化します
- **一流の見た目を既定で持つ**: デザイントークン（配色・タイポスケール）+ 13 レイアウト archetype + 図解部品（プロセス図・タイムライン・KPI・比較・構成図）を CSS 部品として同梱。モデルはテキストを流し込むだけで整った図解になります
- **完成品質の見本に倣う**: gold-standard 完成例デッキを同梱し、ドラフトは常にその水準・構造規約に合わせます
- **別の AI に批判的にレビューさせる**: 作成者ではない `reviewer` サブエージェントが、PNG 画像と Markdown の両面からチェックします
- **PDF / PNG / HTML / PPTX で出力する**: レビュー時に生成した PDF/PNG に加え、要求に応じて追加フォーマットも出力できます

## 必要なもの

- Claude Code 1.0.33 以降
- Docker（Marp CLI・Chromium・日本語フォント（Noto Sans CJK JP / BIZ UDPGothic）は Docker イメージ内で動作します。ローカルに Node.js や Marp CLI を入れる必要はありません）
- `bash` と SHA-256 コマンド。完了ゲートと SHA-256 計算はホスト側の `scripts/review-gate.sh`（Docker の外）が担い、**Windows / macOS / Linux** で動きます。必要なのは `bash`（Windows は Git Bash）と、`sha256sum`（Linux / Git Bash）または `shasum`（macOS）だけです

## セットアップ

1. Docker イメージをビルドする（初回、および `mcp-server/` の更新時）

```bash
cd <path-to-this-repo>/plugins/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

> `mcp-server/src/` を変更したら再ビルドしてください。なお、この MCP イメージは **export 専用**（`marp_export` のみ）です。SHA-256 計算と完了ゲートはホスト側の `scripts/review-gate.sh` が担うため、イメージの新旧は完了ゲートに影響しません

2. plugin を読み込む（clone 済みリポジトリを直接読み込む）

```bash
claude --plugin-dir <path-to-this-repo>/plugins/marp-slide
```

> Docker イメージは手元の clone（または plugin キャッシュ内 `mcp-server/`）からビルドする必要があります。手順 1 を先に済ませてください。

3. Claude Code 内でスキルを呼ぶ

```text
/marp-slide:main
```

`/help` を実行すると `marp-slide` 名前空間の下にスキルが表示されます。

## 使い方

`/marp-slide:main` を実行すると、以下のワークフローで進行します。

```
S1.  Gather : 聞き手・目的・枚数・必須要素などを対話で埋める
S2a. Story  : ストーリーボード（推奨→論拠→全スライドのアクションタイトル→archetype 割当）
              を .slide-work/storyboard.md に固める
S2b. Draft  : gold-standard 見本と同じ構造規約で slides/presentation.md を生成し、
              deck-lint（密度・タイトル長・連続 archetype の機械チェック）を通す
S3.  Review : 別の AI（reviewer サブエージェント）が MCP で PDF/PNG を出力し、
              PNG 目視と Markdown 内容の両面で 12 ゲート判定する。fail なら修正して再実行（最大 3 回）
S4.  Export : review.json.source_sha256 が現在の slides/presentation.md と一致することを確認し、
              必要に応じて HTML/PPTX を追加出力する
```

会話の途中で切れても、`.slide-work/` の状態から自動的に再開ポイントを判定します。

## 12 個のレビュー基準

### ストーリー・タイトル品質
- G1. タイトルが topic label ではなく takeaway（結論文・40 全角字以内・2 行以内）になっている
- G2. 冒頭に聞き手のフック／executive summary がある
- G3. 最終スライドに具体的なアクション／判断要求がある（「ご清聴〜」は fail）
- G4. bullet がタイトルの言い換えではなく独自情報を持つ
- G5. 「必ず入れてほしい内容」（`must_include`）が全て反映されている
- G11. タイトルだけを順に読んでも主張が一本のストーリーとして通る（横のロジック）

### ビジュアル品質
- G6. 全ページの PNG ではみ出し・切れがない
- G7. タイトル除くテキスト 6 行以下、1 リストブロックの bullet 3 つ以下、各 bullet 2 行以下
- G8. 同じレイアウトが 3 枚以上連続しない
- G9. デフォルトの Marp スタイルではなく custom theme が適用されている
- G10. 実際の枚数が target_slide_count の ±3 枚以内
- G12. 本文に inline style・生の色コード・未定義クラスがない（デザイントークン規律）

## 作業ファイル

スキル実行中は `.slide-work/` 以下に状態が作られます。

```text
.slide-work/
|-- request.yaml              # 要件
|-- storyboard.md             # S2a のストーリーボード（タイトル一覧 + archetype 割当）
|-- review.json               # reviewer の判定結果（source_sha256 / review_attempt を含む）
|-- review-blocked.json       # reviewer 不可で停止した未完了マーカー
|-- presentation.pdf          # PDF 出力
|-- preview.html              # HTML プレビュー（要求時）
`-- rendered-pages/
    |-- page-001.png
    `-- ...
slides/
|-- presentation.md           # Marp ソース（編集対象）
`-- assets/                   # ブランドテンプレート使用時のロゴ等（自動コピー）
```

## デザインをカスタマイズしたいとき

- 既定の見た目は `skills/main/templates/presentation-starter.md` が持ちます。冒頭 style ブロックの**デザイントークン**（`--c-*` 配色 / `--fs-*` タイポスケール）を変えると、全部品・全 archetype の見た目が一括で変わります
- 既存デッキのデザインを踏襲したい場合も同様に、`design_reference` にそのファイルパスを指定できます

## 補足

- 完了ゲートと SHA-256 計算は、PDF/PPTX を出力する Docker MCP サーバとは別に、ホスト側の bash スクリプト `scripts/review-gate.sh` が担います（Stop hook から `type: command` で起動、Windows/macOS/Linux 対応）。これにより MCP 接続が切れていても、Docker イメージが古くても、完了ゲートは正しく動作します
- `scripts/deck-lint.sh` は密度・タイトル長・連続 archetype を機械チェックする補助リントです。ドラフト直後のセルフチェックと reviewer の当たり付けに使いますが、判定の権威は reviewer の 12 ゲートです（lint は `review.json` を書きません）
- レビューは Markdown ソースだけでなく、レンダリング後の PNG 画像を Read ツールで目視します（視覚的なはみ出しやレイアウト崩れはソースだけでは判定できないため）
- `reviewer` サブエージェントを起動できない環境では完了ゲートを通せません。既存 reviewer の具体的な fail 修正は適用できますが、`.slide-work/review-blocked.json` を残して未完了停止し、main agent のセルフチェックだけで pass 扱いにはしません
- Docker が起動していない状態で実行すると、MCP からの export がエラーになります。Docker Desktop を起動してから試してください
- `.mcp.json` は `claude` を起動した作業ディレクトリ（カレントディレクトリ）を Docker の `/workspace` に mount します。プロジェクトのルートで `claude` を起動してください
