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
./
├── plugins/
│   ├── marp-slide/                  # Marp スライド作成支援 Plugin
│   └── claude-plugins-official/      # Anthropic 公式 Claude Plugins（submodule）
├── skills/
│   ├── git-flow-commit/              # Git Flow ベースのコミット支援 Skill
│   └── anthropic-skills/             # Anthropic 公式 Skills（submodule）
├── hooks/
│   └── notify-hook/                  # Claude Code 通知 Hook
├── .gitmodules                       # submodule 定義
└── README.md
```

各 Plugin / Skill / Hook の内部構成・セットアップ・使い方は、それぞれの README を参照してください。

## 運用ルール

1. 新規追加は `plugins/<plugin-name>/` に Plugin として配置する
2. 変更は小さく分けてコミットする
3. 破壊的変更はREADMEやリリースノートで明示する
4. 必要に応じてタグを付けてバージョンを管理する

## 収録内容

### Plugin (`plugins/`)

- [`marp-slide`](plugins/marp-slide/README.md): Marp を使ったスライド作成支援 Plugin。要件を対話で整理してスライドを作成し、別 AI によるレビューを通して PDF / PNG / HTML / PPTX へ出力する。
- [`claude-plugins-official`](plugins/claude-plugins-official/README.md): Anthropic 公式の Claude Code Plugin ディレクトリ。公式・コミュニティ Plugin の構成例や marketplace 定義を参照するための submodule。

### Skill (`skills/`)

- [`git-flow-commit`](skills/git-flow-commit/SKILL.md): Git Flow に沿ったブランチ運用とコミット作成を支援する Skill。保護ブランチ警告、機密情報チェック、prefix 付き日本語コミットメッセージ作成を標準化する。
- [`anthropic-skills`](skills/anthropic-skills/README.md): Anthropic 公式の Skills 実装集。文書作成、デザイン、開発、業務ワークフローなどの Skill 例や、Agent Skills の仕様・テンプレートを参照するための submodule。

### Hook (`hooks/`)

- [`notify-hook`](hooks/notify-hook/README.md): Claude Code のタスク完了・入力待ちを OS のネイティブ通知で知らせる Hook。macOS / Windows / Linux 向けの通知スクリプトと設定例を含む。

## 更新方針

- スキル内容は実運用でのフィードバックに基づいて継続的に改善
- 汎用化できる手順は、特定ツール依存を減らして再利用性を高める
- 互換性に影響する変更は、変更理由と移行方法を明記する
