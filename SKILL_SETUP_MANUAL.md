# Codex / Claude Code Skill 設定マニュアル

このリポジトリにある `skills/<skill-name>/SKILL.md` 形式のSkillを、CodexとClaude Codeで使うための手順です。

## 1. Skillの基本構成

最低限、以下の構成にします。

```text
skills/
  <skill-name>/
    SKILL.md
    assets/        # 任意
    scripts/       # 任意
    references/    # 任意
```

`SKILL.md` の先頭には、YAML frontmatterで `name` と `description` を定義します。

```md
---
name: my-skill
description: このSkillが何をするか。どんな依頼で使うべきか。
---
```

## 2. Codex で使う

Codexは、Windowsでは「ユーザーフォルダ（例: `C:\Users\山田太郎`）の中の `.codex\skills`」からSkillを読み込みます。

### 手順

1. エクスプローラーで、このリポジトリの `skills` フォルダを開く
2. 使いたいSkillフォルダ（例: `git-flow-commit`）をコピーする
3. `C:\Users` を開き、自分のユーザー名のフォルダを開く
4. その中に `.codex` フォルダがなければ作成し、その中に `skills` フォルダを作成する
5. `C:\Users\(あなたのユーザー名)\.codex\skills` を開いて、Skillフォルダを貼り付ける
6. `C:\Users\(あなたのユーザー名)\.codex\skills\<skill-name>\SKILL.md` が存在することを確認する

反映されない場合は、Codexを再起動（または新規セッション開始）します。

## 3. Claude Code で使う

Claude Codeでは、用途に応じて2種類の配置先を使います。

- プロジェクト限定: `<project>/.claude/skills`
- 全プロジェクト共通（ユーザーSkill）: ユーザーフォルダ配下の `.claude/skills`

### 手順A: プロジェクト限定で設定

1. エクスプローラーで、このリポジトリの `skills` フォルダを開く
2. 使いたいSkillフォルダをコピーする
3. 対象プロジェクトの `.claude/skills` フォルダを開く
4. その場所にSkillフォルダを貼り付ける
5. `<project>/.claude/skills/<skill-name>/SKILL.md` が存在することを確認する

### 手順B: ユーザー共通で設定

1. エクスプローラーで、このリポジトリの `skills` フォルダを開く
2. 使いたいSkillフォルダをコピーする
3. `C:\Users` を開き、自分のユーザー名のフォルダを開く
4. その中に `.claude` フォルダがなければ作成し、その中に `skills` フォルダを作成する
5. `C:\Users\(あなたのユーザー名)\.claude\skills` を開いて、Skillフォルダを貼り付ける
6. `C:\Users\(あなたのユーザー名)\.claude\skills\<skill-name>\SKILL.md` が存在することを確認する

反映されない場合は、Claude Codeを再起動するか新規セッションを開始します。

## 4. このリポジトリを正として運用する

推奨は、以下の運用です。

1. `skills/<skill-name>/` をこのリポジトリで更新
2. 更新後にCodex/Claude向けディレクトリへコピー
3. 実際の会話でトリガー確認
4. 必要なら `description` の「使う条件」を具体化して再調整

## 5. トラブルシュート

- 読み込まれない: `SKILL.md` のfrontmatter（`name`, `description`）と配置先を確認
- 意図したときに発火しない: `description` に「いつ使うか」を具体的に追記
- フォルダが見えない: エクスプローラーの表示設定で「隠しファイル」を表示して確認
- `.claude/skills` がない: 手動で `.claude` と `skills` フォルダを作成してから貼り付ける
- 競合するSkillがある: `description` をより限定的にするか、名前を明確化
