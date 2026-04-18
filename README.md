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
plugins/    # Plugin（.claude-plugin/plugin.json を持つ配布単位）
skills/     # 単独 SKILL.md ベースの従来資産（新規追加は plugins/ を推奨）
hooks/      # Plugin に属さない単独 Hook（Claude Code の hook を直接 ~/.claude/ に配置するもの）
```

各 Plugin / Skill / Hook の内部構成・セットアップ・使い方は、それぞれの README を参照してください。

## 運用ルール

1. 新規追加は `plugins/<plugin-name>/` に Plugin として配置する
2. 変更は小さく分けてコミットする
3. 破壊的変更はREADMEやリリースノートで明示する
4. 必要に応じてタグを付けてバージョンを管理する

## 既存

### Plugin (`plugins/`)

- [`marp-slide`](plugins/marp-slide/README.md): Marpを使ったスライド作成・レビュー・エクスポート支援（review gate と PDF 画像ベースの visual review 付き、MCP server 同梱）

### Skill (`skills/`)

- [`git-flow-commit`](skills/git-flow-commit/SKILL.md): Git Flowに基づくブランチ運用とコミットワークフローを支援

### Hook (`hooks/`)

- [`notify-hook`](hooks/notify-hook/README.md): タスク完了・入力待ち時に macOS / Windows / Linux でネイティブ通知（Windows は Toast + Claude Code アイコン対応）

## 更新方針

- スキル内容は実運用でのフィードバックに基づいて継続的に改善
- 汎用化できる手順は、特定ツール依存を減らして再利用性を高める
- 互換性に影響する変更は、変更理由と移行方法を明記する
