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
  <plugin-name>/
    .claude-plugin/
      plugin.json    # plugin manifest
    README.md        # セットアップ手順
    skills/
      main/          # メインスキル（/plugin-name:main で呼び出し）
        SKILL.md     # スキル本体
        references/  # 任意: スキル専用の参照資料
        templates/   # 任意: スキル専用テンプレート
    agents/          # 任意: custom agent 定義
    hooks/
      hooks.json     # 任意: plugin hook 定義
    .mcp.json        # 任意: MCP 設定
    mcp-server/      # 任意: MCP サーバー実装
    assets/          # 任意: 画像・テンプレートなど
    scripts/         # 任意: 実行スクリプト
```

共有を前提にしたスキルは、Claude Code docs の plugin 構造に合わせて、plugin root 直下に `skills/`、`agents/`、`hooks/`、`.mcp.json` を配置します。`.claude-plugin/` の中には `plugin.json` だけを置きます。詳しい手順は各スキルの `README.md` を参照してください。

## 運用ルール

1. 共有前提の新規スキルは `skills/<plugin-name>/skills/main/SKILL.md` を正本として追加し、`skills/<plugin-name>/.claude-plugin/plugin.json` を用意する
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
