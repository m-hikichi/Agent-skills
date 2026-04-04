# spec-driven-dev

仕様駆動開発のワークフローを管理する Claude Code プラグイン。

要件定義 → 仕様作成 → 実装 → 監査のサイクルを管理し、トレーサビリティと整合性検証を自動化する。全ての記載は Claude が自動で行い、人間はレビュー・承認・意思決定のみ。整合性検証は全て Docker 内で実行し、ホスト環境を汚さない。

## インストール

```bash
claude --plugin-dir ./spec-driven-dev
```

## プラグイン構成

```
spec-driven-dev/
├── .claude-plugin/
│   └── plugin.json           # プラグインマニフェスト
├── agents/                   # エージェントチーム定義（チームモード用）
│   ├── orchestrator.md       # オーケストレーターエージェント
│   └── auditor.md            # 独立監査エージェント
├── protocols/                # エージェント間メッセージプロトコル
│   └── orchestrator-audit.md # orchestrator ↔ auditor 通信仕様
├── skills/
│   ├── main/                 # 親ルーター兼オーケストレーター（シングルモード用）
│   ├── spec-impact-analysis/ # 変更影響判定（既存仕様なしなら自動bootstrap）
│   ├── spec-authoring/       # 仕様作成・更新（マトリクス初期行も自動記載）
│   ├── spec-implementation/  # 実装・機械検証（途中検証あり）
│   ├── spec-audit/           # 整合性監査（orphan-check・種別充足確認含む）
│   ├── reverse-spec/         # 既存コードからの仕様逆生成
│   └── spec-init/            # プロジェクト初期セットアップ
├── hooks/
│   └── hooks.json            # Stop/SubagentStop/PostToolUse フック定義
├── scripts/                  # 検証スクリプト群
└── tests/                    # スクリプトのテスト
```

## スキル一覧

| コマンド | 説明 |
|----------|------|
| `/spec-driven-dev:main` | 総合窓口。依頼を適切なスキルにルーティング |
| `/spec-driven-dev:spec-init` | プロジェクトの初期セットアップ（対話的scaffold） |
| `/spec-driven-dev:spec-impact-analysis` | 変更の仕様影響を判定。「既存仕様なし」なら自動bootstrap |
| `/spec-driven-dev:spec-authoring` | requirements.md と SPEC-XXX を作成・更新 |
| `/spec-driven-dev:spec-implementation` | 仕様からコード・テスト・マトリクスを実装 |
| `/spec-driven-dev:spec-audit` | 整合性を監査し Findings を返す |
| `/spec-driven-dev:reverse-spec` | 既存コードから最低限の仕様を逆生成 |

## hooks

プラグインをインストールすると、以下のフックが自動的に有効になる。

| hook | タイミング | 目的 |
|------|-----------|------|
| Stop | 完了時 | 整合性チェック + テスト + 最終監査フォーマットを強制 |
| SubagentStop | サブエージェント完了時 | 同上 |
| PostToolUse (Write\|Edit) | コード変更の都度 | SPEC未登録ファイルの早期警告 |

- `needs-user-decision` でも整合性チェックはバイパス不可
- block 理由に Findings 詳細が含まれる
- 全ての Python 処理は Docker 内で実行（ホストに Python 不要）

## 動作モード

### シングルエージェントモード（デフォルト）

従来通り `/spec-driven-dev:main` でルーティング。1つの会話スレッド内で child skill を順番に実行する。

### チームモード

orchestrator + auditor の2エージェントで動作。監査が独立コンテキストで実行されるため、実装バイアスのない検証が可能。

```
orchestrator agent
  ├─ spec-impact-analysis（直接実行）
  ├─ spec-authoring（直接実行）
  ├─ spec-implementation（直接実行）
  └─ SendMessage → auditor agent（独立監査）
        └─ 構造化 Findings を返す
```

チームモードでも hooks（Stop/SubagentStop/PostToolUse）は同じように発火する。整合性チェックのバイパス不可も変わらない。

エージェント間の通信プロトコルは `protocols/orchestrator-audit.md` を参照。

## プロジェクト側の前提

- `spec-config.json` がプロジェクトルートにある
- `docs/requirements.md`、`docs/specs/`、`docs/traceability-matrix.md` がある
- `spec-config.json` の `verification.consistency_runner` が `docker`
- `spec-config.json` の `verification.project_test_commands` が空でない
- Docker が使える

初期セットアップは `/spec-driven-dev:spec-init` で対話的に行える。`spec-config.json` のテンプレートは `skills/main/references/spec-config-template.json` を参照。

## 自動化の方針

- 全ての記載（仕様書、マトリクス、コード、テスト）は Claude が自動で行う
- 人間が手動で記載する箇所はゼロ
- 整合性検証は Docker コンテナ内で実行（ローカル環境を汚さない）
- チェックはスキップ不可（Stop hook で強制）

---

## verify_spec_consistency.py

requirements.md、SPEC-XXX、traceability-matrix.md、実装ファイル、シンボル名、テストIDの対応を機械的に検証するスクリプト。

### 実行方法

Docker 経由で実行する（ホストに Python 不要）:

```bash
docker run --rm \
  -v "$(pwd):/workspace" \
  -v "/path/to/spec-driven-dev:/plugin" \
  -w /workspace \
  python:3.12 \
  python /plugin/scripts/verify_spec_consistency.py --project-root /workspace
```

Windows (PowerShell):

```powershell
docker run --rm `
  -v "${PWD}:/workspace" `
  -v "C:\path\to\spec-driven-dev:/plugin" `
  -w /workspace `
  python:3.12 `
  python /plugin/scripts/verify_spec_consistency.py --project-root /workspace
```

便利スクリプトも用意されている:

```bash
# Unix
sh spec-driven-dev/scripts/run_verify_in_docker.sh .

# Windows PowerShell
pwsh spec-driven-dev/scripts/run_verify_in_docker.ps1 -ProjectRoot .
```

### オプション

| オプション | デフォルト | 説明 |
|-----------|-----------|------|
| `--project-root` | `.` | プロジェクトルートディレクトリ |
| `--config` | `spec-config.json` | 設定ファイルのパス |
| `--orphan-check` | 有効 | SPEC から参照されない実装ファイルを検出 |
| `--no-orphan-check` | - | orphan-check を無効化 |
| `--report` | - | 全 SPEC の進捗一覧を出力（検証は実行しない） |
| `--format` | `text` | 出力形式: `text` または `json` |

### 検証項目

| # | チェック内容 | 重大度 |
|---|------------|--------|
| 1 | requirements.md の Traceability 表が存在し空でない | High |
| 2 | SPEC-XXX に spec_id frontmatter がある | High |
| 3 | SPEC-XXX に実装トレーサビリティ契約がある | High |
| 4 | SPEC-XXX に実装完了条件がある | High |
| 5 | 契約表の機能IDが機能仕様セクションに存在する | High |
| 6 | 契約表の機能IDに実装完了条件がある | High |
| 7 | 実装ファイルが実在する | High |
| 8 | 実装ファイル内にシンボル（関数/クラス/コンポーネント）が存在する | High |
| 9 | テストファイルが実在する | High |
| 10 | テストコード内に TC-XXX が検索可能な文字列として存在する | Medium |
| 11 | テスト仕様セクションで定義された TC-XXX が契約表で参照されている | Medium |
| 12 | マトリクス行と契約表の突合（ファイル/シンボル/テストID一致） | High |
| 13 | マトリクス行が requirements Traceability と整合する | High |
| 14 | 期待されるマトリクス行が全て存在する | High |
| 15 | requirements Traceability が SPEC 対応要件表に反映されている | High |
| 16 | SPEC から参照されない実装ファイルの検出（orphan-check） | High |

### 出力例

#### 検証成功時

```
OK: spec consistency check passed.
```

#### 検証失敗時

```
Findings:
- High: SPEC-001 / FR-001 implementation file not found: src/todos/create.ts
- High: matrix row missing from expected coverage: FC-01-01-001 -> SPEC-001 / FR-001
- Medium: SPEC-001 / FR-001 test id TC-001 not found in tests/test_create_todo.py
```

#### レポートモード (`--report`)

```
| SPEC | Status | FR Total | Implemented | Tested |
|------|--------|----------|-------------|--------|
| SPEC-001 | approved | 3 | 2 | 1 |
| SPEC-002 | draft | 5 | 0 | 0 |
| **Total** | | **8** | **2** | **1** |
```

#### JSON 出力 (`--format json`)

```json
{
  "ok": false,
  "findings": [
    {
      "severity": "High",
      "message": "SPEC-001 / FR-001 implementation file not found: src/todos/create.ts"
    }
  ]
}
```

### spec-config.json の設定

verify_spec_consistency.py が参照する設定:

```json
{
  "spec_dir": "docs/specs",
  "traceability_path": "docs/traceability-matrix.md",
  "requirements_path": "docs/requirements.md",
  "implementation_roots": ["src", "app"],
  "verification": {
    "consistency_runner": "docker",
    "project_test_commands": [
      "docker compose run --rm app npm test"
    ]
  }
}
```

| キー | 説明 |
|------|------|
| `spec_dir` | SPEC-XXX ファイルのディレクトリ |
| `traceability_path` | トレーサビリティマトリクスのパス |
| `requirements_path` | requirements.md のパス |
| `implementation_roots` | 実装ファイルのルートディレクトリ（orphan-check 対象） |
| `verification.consistency_runner` | `docker` 固定 |
| `verification.project_test_commands` | プロジェクト固有テストコマンド |

### テストの実行

```bash
docker run --rm \
  -v "/path/to/spec-driven-dev:/work" \
  -w /work \
  python:3.12 \
  python -m unittest discover -s tests -v
```
