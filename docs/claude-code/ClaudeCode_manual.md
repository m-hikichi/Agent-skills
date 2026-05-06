# Claude Code（ClaudeCode）使い方マニュアル（配布資料版）

> 対象：VS Code / Git は触ったことがあるエンジニア（個人〜チーム開発まで）  
> 目的：**Claude Code を安全に導入し、日常の開発で再現性のある形で使いこなす**  
> 方針：本文の主張は **公式ドキュメント（一次情報）で裏取りできる形**で記載する（末尾に参照リンクを集約）。

---

## 目次
- 1. Claude Code とは
- 2. 導入（インストール／初回起動／ログイン）
- 3. アップデートとアンインストール（クリーンアップ含む）
- 4. 設定の基本（スコープ、設定ファイル、/config）
- 5. セキュリティ：キーや機密ファイルを「読ませない」設計
- 6. メモリ運用：`CLAUDE.md` / rules（チーム規約の定着）
- 7. Skills 運用：`SKILL.md`（作業の“コマンド化”）
- 8. MCP：外部ツール連携（Model Context Protocol）
- 9. よく使うスラッシュコマンド（/…）一覧
- 付録A. 配布用テンプレート（コピペで使える雛形）

---

## 1. Claude Codeとは

Claude Code は **ターミナルで動作する agentic（自律型）アシスタント**です。コーディングに強いだけでなく、ドキュメント作成、ビルド実行、ファイル検索、調査など **「コマンドラインからできること」全般**を支援します。([Claude Code][1])

---

## 2. 導入（インストール／初回起動／ログイン）

### 2.1 推奨：Native Install（macOS / Linux / WSL）
```bash
curl -fsSL https://claude.ai/install.sh | bash
````

### 2.2 Windows（PowerShell / CMD）

PowerShell:

```powershell
irm https://claude.ai/install.ps1 | iex
```

CMD:

```bat
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

### 2.3 Homebrew / WinGet

Homebrew:

```bash
brew install --cask claude-code
```

WinGet:

```powershell
winget install Anthropic.ClaudeCode
```

### 2.4 初回起動（プロジェクトで起動）

```bash
cd your-project
claude
```

基本は「リポジトリ／プロジェクトディレクトリで起動して作業」します。([Claude Code][2])

### 2.5 ログイン（/login）

アカウント切替や再ログインが必要な場合、Claude Code 内で `/login` を使うことができます。([Claude Code][3])

---

## 3. アップデートとアンインストール（クリーンアップ含む）

### 3.1 アップデート

#### 3.1.1 自動更新
Claude Code は最新の機能とセキュリティ修正を確保するため、自動的に自身を最新に保ちます。([Claude Code][2])

- 更新チェック：起動時および実行中に定期的に実行
- 更新プロセス：バックグラウンドで自動的にダウンロード／インストール
- 通知：更新がインストールされたときに通知
- 反映タイミング：更新は **次回起動時に有効化**（更新後は再起動すると確実）

> 注意：Homebrew / WinGet で入れた場合は **自動更新されません**。

#### 3.1.2 手動更新
手動で最新バージョンへ更新する場合は、以下を実行します。([Claude Code][2])

```bash
claude update
````

* Homebrew（自動更新されない）：

  ```bash
  brew upgrade claude-code
  ```
* WinGet（自動更新されない）：

  ```powershell
  winget upgrade Anthropic.ClaudeCode
  ```

#### 3.1.3 リリースチャネル（latest / stable）の設定

自動更新と `claude update` が追従するチャネルは `autoUpdatesChannel` で設定できます。([Claude Code][2])

* `"latest"`（デフォルト）：リリースされるとすぐに新機能を受け取る
* `"stable"`：通常約1週間古いバージョンを使い、大きな回帰のあるリリースをスキップ

設定方法：

* `/config` → 自動更新チャネル で設定、または settings.json に追記

```json
{
  "autoUpdatesChannel": "stable"
}
```

#### 3.1.4 自動更新を無効にする（必要な場合のみ）

自動更新を止めたい場合は、シェルまたは settings.json ファイルで`DISABLE_AUTOUPDATER` を環境変数として設定します。([Claude Code][2])

```bash
export DISABLE_AUTOUPDATER=1
```

---

### 3.2 アンインストール（Native Install）

Claude Code をアンインストールする必要がある場合は、インストール方法の指示に従ってください。([Claude Code][2])

macOS / Linux / WSL:

```bash
rm -f ~/.local/bin/claude
rm -rf ~/.local/share/claude
```

Windows PowerShell:

```powershell
Remove-Item -Path "$env:USERPROFILE\.local\bin\claude.exe" -Force
Remove-Item -Path "$env:USERPROFILE\.local\share\claude" -Recurse -Force
```

Homebrew:

```bash
brew uninstall --cask claude-code
```

WinGet:

```powershell
winget uninstall Anthropic.ClaudeCode
```

NPM:

```bash
npm uninstall -g @anthropic-ai/claude-code
```

### 3.4 状態のクリーンアップ（設定・履歴などを消す：任意）

（設定、許可されたツール、MCPサーバ設定、セッション履歴なども削除されます）

macOS / Linux / WSL:

```bash
# ユーザー設定と状態を削除
rm -rf ~/.claude
rm ~/.claude.json

# プロジェクト固有の設定を削除（プロジェクトディレクトリから実行）
rm -rf .claude
rm -f .mcp.json
```

---

## 4. 設定の基本（スコープ、設定ファイル、/config）

Claude Code は、設定の適用範囲と共有範囲を **スコープ**で分けます（例：ユーザー全体／プロジェクト共有／個人ローカル）。([Claude Code][4])

### 4.1 主要な設定ファイル

* User settings：`~/.claude/settings.json`（全プロジェクトに適用）
* Project settings：`.claude/settings.json`（リポジトリにコミットしてチーム共有）
* Local settings：`.claude/settings.local.json`（コミットしない個人用。作成時に git が ignore するよう構成される）

### 4.2 /config で設定UIを開く

インタラクティブ REPL 中に `/config` を実行すると、タブ付き設定インターフェースが開き、ステータスや構成を変更できます。([Claude Code][4])

---

## 5. セキュリティ：キーや機密ファイルを「読ませない」設計

### 5.1 原則：機密は“ファイルに置かない”

APIキー等は、可能なら **環境変数**として渡す（例：MCPの `--env`）設計に寄せます。([Claude Code][5])

### 5.2 公式推奨：permissions.deny で Read を拒否する（本命）

APIキー／シークレット／環境ファイルなどの機密情報を含むファイルへのアクセスを防ぐには、`.claude/settings.json` の `permissions.deny` を使います。
`deny` に一致するファイルは「ファイル検出と検索結果から除外」され、「読み取り操作は拒否」されます。([Claude Code][4])

例（プロジェクトで共有する推奨形）：

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./config/credentials.json)",
      "Read(./build)"
    ]
  }
}
```

### 5.3 respectGitignore（補助）：ファイル候補に出にくくする

`respectGitignore` は `@` のファイルピッカーが `.gitignore` を尊重するかを制御し、`true`の場合、`.gitignore` 一致ファイルを提案から除外できます（※提案制御であり、アクセス拒否の本命は  `deny`）。([Claude Code][4])

### 5.4 防御を厚くする（推奨運用）

* **deny は project `.claude/settings.json` に入れてチームで固定**（漏洩事故の再発防止）
* 個人固有の設定（例：個人の補助パス、個人の好み）は `.claude/settings.local.json` に逃がす（コミットしない）([Claude Code][4])

---

## 6. メモリ（CLAUDE.md）運用：プロジェクトルールを定着させる

Claude Code はセッション間で「指示（メモリ）」を保持でき、階層構造で複数ロケーションのメモリを読み込みます。

### 6.1 メモリの種類と配置

代表的な配置（抜粋）：([Claude Code][6])

* プロジェクトメモリ：`./CLAUDE.md` または `./.claude/CLAUDE.md`
* プロジェクトルール：`./.claude/rules/*.md`（モジュール化）
* ユーザーメモリ：`~/.claude/CLAUDE.md`
* ローカル（個人のプロジェクト固有）：`./CLAUDE.local.md`（自動で .gitignore に追加）

### 6.2 /init で CLAUDE.md をブートストラップ

`/init` は `CLAUDE.md` ガイドでプロジェクトを初期化します。([Claude Code][7])

### 6.3 メモリの分割

`CLAUDE.md` は `@path/to/import` 構文で追加ファイルをインポートできます（相対・絶対パス可）。次の例は3つのファイルをインポートします：([Claude Code][6])

```markdown
See @README for project overview and @package.json for available npm commands for this project.

# Additional Instructions
- git workflow @docs/git-instructions.md
```

潜在的な衝突を避けるため、インポートはマークダウンコードスパンとコードブロック内では評価されません。([Claude Code][6])

```markdown
This code span will not be treated as an import: `@anthropic-ai/claude-code`
```

インポートされたファイルは再帰的に追加ファイルをインポートでき、最大深さは5ホップです。`/memory`コマンドを実行することで、どのメモリファイルが読み込まれているかを確認できます。

### 6.4 `.claude/rules/` を使用したモジュール化ルール）

大規模なプロジェクトの場合、`.claude/rules/`ディレクトリを使用して指示を複数のファイルに整理できます。これにより、チームは1つの大きなCLAUDE.mdの代わりに、焦点を絞った、よく整理されたルールファイルを維持できます。([Claude Code][6])
`.claude/rules/` 配下の `.md` は自動的にプロジェクトメモリとして読み込まれ、`.claude/CLAUDE.md` と同じ優先度を持ちます。

```
your-project/
├── .claude/
│   ├── CLAUDE.md           # Main project instructions
│   └── rules/
│       ├── code-style.md   # Code style guidelines
│       ├── testing.md      # Testing conventions
│       └── security.md     # Security requirements
```


`paths`フィールドを持つYAMLフロントマターで「特定パスの時だけ適用」も可能です。([Claude Code][6])

```
---
paths: src/api/**/*.ts
---

# API Development Rules

- All API endpoints must include input validation
- Use the standard error response format
- Include OpenAPI documentation comments
```

---

## 7. Skills（SKILL.md）運用：チームの作業を“コマンド化”する

Skills は Claude Code の能力拡張で、スキルディレクトリに `SKILL.md` を置くと Claude のツールキットに追加されます。Claude は会話内容に関連すると判断したときに自動ロードでき、また `/skill-name` で明示的に呼び出しできます。([Claude Code][8])

### 7.1 置き場所（スコープ）

* Personal（全プロジェクト）：`~/.claude/skills/<skill-name>/SKILL.md`
* Project（リポジトリ単位）：`.claude/skills/<skill-name>/SKILL.md`

### 7.2 スキルは「ディレクトリ」単位で作る

各スキルは `SKILL.md` をエントリポイントとする ディレクトリです。`SKILL.md` 以外にテンプレ・例・参照資料・実行スクリプト等を同梱でき、`SKILL.md` から参照して必要時に読ませる設計が推奨です。([Claude Code][8])

### 7.3 自動実行を止める：disable-model-invocation

- `disable-model-invocation: true` を入れると、Claude による自動呼び出しを禁止し、ユーザーが手動で呼ぶ用途に寄せます。
- `user-invocable: false` を入れると、`/` メニューから隠すことができます。ユーザーが直接呼び出すべきではないバックグラウンド知識用に使用します。([Claude Code][8])

---

## 8. MCPサーバ設定：外部ツール連携（Model Context Protocol）

Claude Code は MCP（Model Context Protocol）により、外部ツール／データソースへ接続できます。  
出典：MCP（概要） ([Claude Code][5])

### 8.1 MCPサーバーのインストール

HTTP（推奨）：

```bash
# 基本的な構文
claude mcp add --transport http <name> <url>

# 実際の例：Notionに接続する
claude mcp add --transport http notion https://mcp.notion.com/mcp

# Bearerトークンを使用した例
claude mcp add --transport http secure-api https://api.example.com/mcp \
  --header "Authorization: Bearer your-token"
```

stdio：

```bash
# 基本的な構文
claude mcp add [options] <name> -- <command> [args...]

# 実際の例：Airtableサーバーを追加する
claude mcp add --transport stdio --env AIRTABLE_API_KEY=YOUR_KEY airtable -- npx -y airtable-mcp-server
```

### 8.2 管理（list/get/remove）

```bash
# すべての構成済みサーバーをリストする
claude mcp list

# 特定のサーバーの詳細を取得する
claude mcp get github

# サーバーを削除する
claude mcp remove github

# （Claude Code内）サーバーステータスを確認する
/mcp
```

---

## 9. よく使うスラッシュコマンド（/…）一覧

Claude Code のインタラクティブモードでは、`/` で始まるコマンドでセッション操作や設定ができます。  
出典：インタラクティブモード（日本語） ([Claude Code][7])

### 9.1 まず覚える（運用・保守）

* `/help`：使用方法ヘルプを取得
* `/doctor`：Claude Code インストールの健全性をチェック
* `/status`：設定インターフェース（Status タブ）を開く。バージョン、モデル、アカウント、接続性を表示
* `/config`：設定インターフェース（Config タブ）を開く

### 9.2 コンテキスト管理（長い開発で効く）

* `/compact [instructions]`：オプションのフォーカス指示付きで会話をコンパクト化
* `/context`：	現在のコンテキスト使用状況をカラーグリッドとして視覚化
* `/clear`：会話履歴をクリア

### 9.3 メモリ運用

* `/init`：`CLAUDE.md` ガイドでプロジェクト初期化
* `/memory`：`CLAUDE.md` メモリファイルを編集

### 9.4 MCP

* `/mcp`：MCP サーバー接続と OAuth 認証を管理

### 9.5 コスト・利用状況

* `/cost`：トークン使用統計を表示
* `/usage`：サブスクリプション向けの使用制限／レート制限ステータスを表示
* `/stats`：日次使用状況、セッション履歴、ストリーク、モデル設定を視覚化

---

# 付録A. 配布用テンプレート（コピペで使える雛形）

## A-1. プロジェクト推奨ディレクトリ構成（最小）

```
your-project/
├─ .claude/
│  ├─ settings.json          # チーム共有（deny等）
│  ├─ CLAUDE.md              # プロジェクト共有メモリ（任意：ルートに置いても可）
│  ├─ rules/                 # ルール分割
│  │  ├─ code-style.md
│  │  ├─ testing.md
│  │  └─ security.md
│  └─ skills/
│     └─ review/
│        └─ SKILL.md
├─ CLAUDE.md                 # こちらに置く運用でも可
└─ ...
```
([Claude Code][6])([Claude Code][8])

## A-2. `.claude/settings.json`（機密を読ませない最小例）

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "Read(./config/credentials.json)"
    ]
  }
}
```
 ([Claude Code][4])

## A-3. `CLAUDE.md`（最小ひな形）

```md
# Project Context
- What this repo is / what we are building
- Key commands: build/test/lint
- Key directories and architecture notes

# Working Agreement
- Branch strategy
- Commit message rules
- Review checklist

# Imports
- @docs/policies/coding-style.md
- @docs/policies/testing.md
```
([Claude Code][7])

## A-4. `.claude/rules/security.md`（パス限定ルール例）

```md
---
paths: src/api/**/*.ts
---

# API Security Rules
- Validate inputs for every endpoint
- Do not log secrets
- Follow standard error format
```
([Claude Code][6])

## A-5. `.claude/skills/review/SKILL.md`（最小例）

```md
---
name: review
description: Review changes with a security+testing checklist and propose fixes.
disable-model-invocation: true
---

# What to do
- Summarize the diff
- Identify risky changes
- Propose concrete fixes
- Output a checklist
```
([Claude Code][8])



[1]: https://code.claude.com/docs/ja/how-claude-code-works "Claude Code の仕組み - Claude Code Docs"
[2]: https://code.claude.com/docs/ja/setup "Claude Code をセットアップする - Claude Code Docs"
[3]: https://code.claude.com/docs/ja/quickstart "クイックスタート - Claude Code Docs"
[4]: https://code.claude.com/docs/ja/settings "Claude Code の設定 - Claude Code Docs"
[5]: https://code.claude.com/docs/ja/mcp "MCPを使用してClaude Codeをツールに接続する - Claude Code Docs"
[6]: https://code.claude.com/docs/ja/memory "Claudeのメモリを管理する - Claude Code Docs"
[7]: https://code.claude.com/docs/ja/interactive-mode "インタラクティブモード - Claude Code Docs"
[8]: https://code.claude.com/docs/ja/skills "Claude をスキルで拡張する - Claude Code Docs"
