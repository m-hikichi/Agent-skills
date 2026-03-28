# marp-slide スキル

このスキルは、厳格なレビューゲート付きで Marp スライド作成を支援します。要件整理、構成承認、ドラフト作成、レビュー、エクスポート確認には `.slide-work/` の状態ファイルを使用します。利用先プロジェクトへコピーする配布物は `package/` にまとめています。

このバージョンでは、レビューゲートは `SKILL.md` の frontmatter hooks にあります。reviewer が `pass` を返すまで、このタスクは完了できません。見た目レビューは、生の Markdown ではなく、レンダリング済みの各スライド PNG 画像に基づいて行います。

## 責務

- MCP サーバー `marp`
  - `marp_export`
- reviewer
  - PDF を出力する
  - ページ画像を出力する
  - ページ画像を確認する
  - `.slide-work/review.json` を上書きする
- `SKILL.md`
  - 状態機械
  - 完了ルール
  - hooks

visual review のロジックは意図的に MCP の外に置いています。

## セットアップ

### 必要なもの

- Claude Code
- Docker

ローカルの Node.js や Marp CLI は不要です。Marp CLI、Chromium、日本語フォントは Docker イメージ内で動作します。

### 導入手順

1. `package/.claude/` を利用先プロジェクトのルートにコピーします

```bash
cp -r <path-to-this-repo>/skills/marp-slide/package/.claude/ <your-project>/.claude/
```

2. `package/.mcp.json` を利用先プロジェクトのルートにコピーします

```bash
cp <path-to-this-repo>/skills/marp-slide/package/.mcp.json <your-project>/.mcp.json
```

3. Docker イメージをビルドします

```bash
cd <path-to-this-repo>/skills/marp-slide/mcp-server
docker build -t marp-mcp-server .
```

## ディレクトリ構成

```text
skills/marp-slide/
|-- package/
|   |-- .claude/
|   |   |-- agents/
|   |   |   \-- slide-reviewer.md
|   |   \-- skills/
|   |       \-- marp-slide/
|   |           |-- SKILL.md
|   |           |-- templates/
|   |           |   |-- request-template.yaml
|   |           |   |-- outline-template.yaml
|   |           |   |-- review-template.json
|   |           |   \-- presentation-starter.md
|   |           |-- references/
|   |           |   |-- presentation-structures.md
|   |           |   |-- layout-patterns.md
|   |           |   \-- design-reference-playbook.md
|   \-- .mcp.json
|-- README.md
\-- mcp-server/
    |-- Dockerfile
    |-- package.json
    |-- tsconfig.json
    \-- src/
        \-- index.ts
```

## 生成される作業ファイル

```text
.slide-work/
|-- request.yaml
|-- outline.yaml
|-- review.json
|-- preview.html
|-- presentation.pdf
|-- presentation.pptx
\-- rendered-pages/
    |-- page-001.png
    |-- page-002.png
    \-- ...
```

## Reviewer の動作

`agents/slide-reviewer.md` は厳格な reviewer です。常に次の順で処理します。

1. 必須情報を確認する
2. `slides/presentation.md` を確認する
3. reviewer 自前の source checks を実行する
4. PDF を出力する
5. ページ画像を出力する
6. ページ画像を確認する
7. 必要な export を検証する
8. `review.json` を上書きする

reviewer はデッキを修正しません。返すのは `missing_info`、`fail`、`pass` のいずれかだけです。

## Hooks

レビューゲートは `SKILL.md` frontmatter hooks が正本です。

- `PostToolUse`
  - 次の変更後にレビューを再実行します:
    - `slides/presentation.md`
    - `.slide-work/request.yaml`
    - `.slide-work/outline.yaml`
- `Stop`
  - すべてのレビューゲートが通るまで完了をブロックします:
    - reviewer が `pass` を返している
    - reviewer 自前の source checks が成功している
    - 必要な export が成功している
    - visual review が成功している
    - ページ画像が存在している

## Visual Review の流れ

ページ画像は `marp_export` の PNG 出力で生成します。reviewer は PDF とあわせて、各スライド画像を PNG で出力します。MCP は Marp の連番 PNG を `.slide-work/rendered-pages/page-001.png` 形式に正規化して扱います。

- `.slide-work/presentation.pdf`
- `.slide-work/rendered-pages/page-001.png`
- `.slide-work/rendered-pages/page-002.png`

## 完了条件

次のすべてが真のときだけ、このタスクは完了です。

1. `review.json.status == "pass"`
2. `missing_required`、`issues`、`questions_for_user`、`exact_fix_instructions` が空である
3. `validation.source_checks.status == "pass"`
4. `validation.exports.required_formats_satisfied == true`
5. `validation.visual_review.executed == true`
6. `validation.visual_review.status == "pass"`
7. `validation.visual_review.checked_page_count > 0`
8. `.slide-work/presentation.pdf` が存在する
9. `.slide-work/rendered-pages/page-###.png` が存在する
10. ワークフロー上必要な場合、ユーザー承認が記録されている

## 注意

- 常に `.slide-work/...` を使ってください
- MCP の責務は export に限定されます
