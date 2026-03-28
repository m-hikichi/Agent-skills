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
    SKILL.md
    assets/        # 任意: 画像・テンプレートなど
    scripts/       # 任意: 実行スクリプト
    references/    # 任意: 参照資料
```

## 運用ルール

1. 新規スキルは `skills/<skill-name>/SKILL.md` に追加する
2. 変更は小さく分けてコミットする
3. 破壊的変更はREADMEやリリースノートで明示する
4. 必要に応じてタグを付けてバージョンを管理する

## 既存スキル

- `git-flow-commit`: Git Flowに基づくブランチ運用とコミットワークフローを支援
- `spec-driven-dev`: 仕様系作業の総合窓口ルーター。迷ったときの入口であり、hooks / reviewer / verification scripts の共通基盤もここに置く
- `spec-impact-analysis`: コード変更前に、仕様影響あり / なしを判定する
- `spec-authoring`: `requirements.md` と `SPEC-XXX` を作成 / 更新する
- `spec-implementation`: approved な仕様からコード / テスト / マトリクスを実装し、機械検証まで回す
- `spec-audit`: requirements / specs / matrix / code / tests の整合性を監査し、Findings を返す
- `reverse-spec`: 仕様資産がない既存コードを spec-driven-dev family に入れる前の bootstrap skill

## spec-driven-dev family

`spec-driven-dev` 系は、1つの巨大な SKILL.md ではなく、役割ごとに分割した skill 群として管理する。

- 親: `spec-driven-dev`
- core child: `spec-impact-analysis`, `spec-authoring`, `spec-implementation`, `spec-audit`
- bootstrap: `reverse-spec`

使い方の基本は次の通り。

- 入口が曖昧なら親 `spec-driven-dev`
- 目的が明確なら core child skill を直接使う
- 実装系の往復は親 `spec-driven-dev` が `spec-authoring` / `spec-implementation` / `spec-audit` をオーケストレーションする
- 仕様資産が無い既存コードだけは `reverse-spec` で bootstrap してから family に入る
- 最後の停止可否は `skills/spec-driven-dev/scripts/` と `.claude/settings.json` の reviewer が判定する
- skill 固有のテンプレートや playbook は各 skill の `references/` に置く

フォルダは skill loader の都合で `skills/<skill-name>/SKILL.md` の sibling 構成を保ち、family か bootstrap かの区別は docs と責務定義で表現する。

完了ブロックの強制力は SKILL.md 単体ではなく、`skills/spec-driven-dev/scripts/` と `.claude/settings.json` の `Stop / SubagentStop` reviewer にある。分割後もこの前提は変えない。

## 更新方針

- スキル内容は実運用でのフィードバックに基づいて継続的に改善
- 汎用化できる手順は、特定ツール依存を減らして再利用性を高める
- 互換性に影響する変更は、変更理由と移行方法を明記する
