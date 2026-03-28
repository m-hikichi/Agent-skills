# agent-skills

Claude CodeのSkillsや、ほかの生成AIで再利用できるskillsを配布・継続更新するためのリポジトリです。

## 目的

- skillsの定義を一元管理する
- 改善履歴をGitで追跡できるようにする
- 個人/チームで再利用しやすい形で公開する

## 想定する利用先

- Claude Code
- SKILL.md形式の手順を読み込める生成AIワークフロー
- プロンプト資産をリポジトリ管理したい開発チーム

## ディレクトリ構成

```text
skills/
  <skill-name>/
    README.md        # セットアップ手順
    package/         # 利用先へコピーする配布物
      .claude/
        skills/<skill-name>/
          SKILL.md   # スキル本体（frontmatter hooks を含めてもよい）
        agents/      # 任意: subagent 定義
        settings.json  # 任意: 互換用 hooks 設定
      .mcp.json      # 任意: MCP 設定
    assets/          # 任意: 画像・テンプレートなど
    scripts/         # 任意: 実行スクリプト
    references/      # 任意: 参照資料
```

各スキルの `package/` には、利用先プロジェクトへコピーする `.claude/` や `.mcp.json` をまとめます。hooks は `SKILL.md` frontmatter に持たせてもよく、`settings.json` は互換用の任意ファイルです。詳しい手順は各スキルの `README.md` を参照してください。

## 運用ルール

1. 新規スキルは `skills/<skill-name>/package/.claude/skills/<skill-name>/SKILL.md` を正本として追加する
2. 変更は小さく分けてコミットする
3. 破壊的変更はREADMEやリリースノートで明示する
4. 必要に応じてタグを付けてバージョンを管理する

## 既存スキル

- `git-flow-commit`: Git Flowに基づくブランチ運用とコミットワークフローを支援
- `marp-slide`: Marpを使ったスライド作成・レビュー・エクスポート支援（review gate と PDF 画像ベースの visual review 付き）

## 更新方針

- スキル内容は実運用でのフィードバックに基づいて継続的に改善
- 汎用化できる手順は、特定ツール依存を減らして再利用性を高める
- 互換性に影響する変更は、変更理由と移行方法を明記する
