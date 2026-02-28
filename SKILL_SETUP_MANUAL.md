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

CodexはユーザーSkillを `~/.codex/skills`（Windowsでは `%USERPROFILE%\.codex\skills`）から読み込みます。

### 手順（PowerShell）

```powershell
$SkillName = "git-flow-commit"
$RepoRoot = "C:\\path\\to\\agent-skills"
$Dest = "$HOME\.codex\skills\$SkillName"

New-Item -ItemType Directory -Force $Dest | Out-Null
Copy-Item -Recurse -Force "$RepoRoot\skills\$SkillName\*" $Dest
```

### 反映確認

```powershell
Get-ChildItem "$HOME\.codex\skills"
```

Skill追加後はCodexを再起動（または新規セッション開始）します。

## 3. Claude Code で使う

Claude Codeでは、用途に応じて2種類の配置先を使います。

- プロジェクト限定: `<project>/.claude/skills`
- 全プロジェクト共通（ユーザーSkill）: `~/.claude/skills`

### 手順A: プロジェクト限定で設定

```powershell
$SkillName = "git-flow-commit"
$RepoRoot = "C:\\path\\to\\agent-skills"
$ProjectRoot = "C:\path\to\your-project"
$Dest = "$ProjectRoot\.claude\skills\$SkillName"

New-Item -ItemType Directory -Force $Dest | Out-Null
Copy-Item -Recurse -Force "$RepoRoot\skills\$SkillName\*" $Dest
```

### 手順B: ユーザー共通で設定

```powershell
$SkillName = "git-flow-commit"
$RepoRoot = "C:\\path\\to\\agent-skills"
$Dest = "$HOME\.claude\skills\$SkillName"

New-Item -ItemType Directory -Force $Dest | Out-Null
Copy-Item -Recurse -Force "$RepoRoot\skills\$SkillName\*" $Dest
```

### 反映確認

```powershell
Get-ChildItem "$HOME\.claude\skills"
```

既存セッションに反映されない場合は、Claude Codeを再起動するか新規セッションを開始します。

## 4. このリポジトリをソース管理の正とする運用

推奨は、以下の運用です。

1. `skills/<skill-name>/` をこのリポジトリで更新
2. 更新後にCodex/Claude向けディレクトリへコピー
3. 実際の会話でトリガー確認
4. 必要なら `description` の「使う条件」を具体化して再調整

## 5. トラブルシュート

- 読み込まれない: `SKILL.md` のfrontmatter（`name`, `description`）と配置先を確認
- 意図したときに発火しない: `description` に「いつ使うか」を具体的に追記
- 競合するSkillがある: `description` をより限定的にするか、名前を明確化

