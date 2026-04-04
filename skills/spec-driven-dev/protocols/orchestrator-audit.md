# Orchestrator-Audit Message Protocol

orchestrator agent と auditor agent が `SendMessage` で交換するメッセージの仕様。

## 設計原則

- メッセージ本文はプレーンテキスト。構造化データは fenced JSON ブロックで埋め込む
- プロトコルバージョンを明示し、将来の拡張に備える
- シングルエージェント運用では使われない。既存の SKILL.md close-out フォーマットを壊さない

---

## 1. Audit Request（orchestrator -> auditor）

orchestrator が監査を依頼するときに送る。

```
監査を依頼します。

\`\`\`json
{
  "protocol": "spec-driven-dev/audit",
  "version": "1.0",
  "type": "audit_request",
  "phase": "post-implementation",
  "scope": {
    "specs": ["SPEC-012"],
    "requirements_path": "docs/requirements.md",
    "traceability_path": "docs/traceability-matrix.md",
    "changed_files": ["src/foo.ts", "tests/foo.test.ts"]
  },
  "context": "SPEC-012 FR-001 ~ FR-003 の実装完了。全体監査を依頼。",
  "iteration": 1
}
\`\`\`
```

### フィールド定義

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `protocol` | string | Yes | 固定: `"spec-driven-dev/audit"` |
| `version` | string | Yes | 固定: `"1.0"` |
| `type` | string | Yes | 固定: `"audit_request"` |
| `phase` | string | Yes | `"post-implementation"`, `"post-authoring-fix"`, `"post-implementation-fix"`, `"final"` のいずれか |
| `scope.specs` | string[] | Yes | 監査対象の SPEC ID 一覧 |
| `scope.requirements_path` | string | Yes | requirements.md のパス |
| `scope.traceability_path` | string | Yes | traceability-matrix.md のパス |
| `scope.changed_files` | string[] | No | 今回変更したファイル一覧（監査の焦点を絞るヒント） |
| `context` | string | Yes | 何をしたかの自由記述 |
| `iteration` | number | Yes | 監査-修正ループの回数（1 始まり） |

### phase の意味

| phase | いつ使うか |
|---|---|
| `post-implementation` | 初回実装完了後 |
| `post-authoring-fix` | spec-fix 修正後の再監査 |
| `post-implementation-fix` | implementation-fix 修正後の再監査 |
| `final` | orchestrator が最終確認として依頼 |

---

## 2. Audit Response（auditor -> orchestrator）

auditor が監査結果を返すときに送る。

```
監査完了。結果を報告します。

\`\`\`json
{
  "protocol": "spec-driven-dev/audit",
  "version": "1.0",
  "type": "audit_response",
  "verdict": "findings-present",
  "consistency_check": {
    "passed": true,
    "orphan_check": true,
    "output_summary": "OK: spec consistency check passed."
  },
  "test_type_coverage": {
    "passed": false,
    "missing": [
      {
        "spec": "SPEC-012",
        "requirement": "FR-002",
        "missing_types": ["boundary"]
      }
    ]
  },
  "findings": [
    {
      "id": 1,
      "severity": "High",
      "classification": "implementation-fix",
      "spec": "SPEC-012",
      "requirement": "FR-001",
      "summary": "matrix 行が実装トレーサビリティ契約と一致しない",
      "evidence": "matrix は src/foo.ts を指しているが、仕様は src/bar.ts",
      "impact": "仕様から実装を追跡できない",
      "required_update": "matrix または契約表のどちらが正しいか揃える"
    },
    {
      "id": 2,
      "severity": "Medium",
      "classification": "spec-fix",
      "spec": "SPEC-012",
      "requirement": "FR-002",
      "summary": "テスト仕様に境界値テストが定義されていない",
      "evidence": "テスト仕様セクションに正常系と異常系のみ",
      "impact": "境界条件のバグを見逃すリスク",
      "required_update": "テスト仕様に境界値テストケースを追加"
    }
  ],
  "audit_summary": {
    "targets": ["requirements.md", "SPEC-012", "src/foo.ts", "tests/foo.test.ts"],
    "verifications_run": ["verify_spec_consistency.py (orphan-check)", "project_test_commands"],
    "high_count": 1,
    "medium_count": 1,
    "low_count": 0
  }
}
\`\`\`
```

### フィールド定義

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `protocol` | string | Yes | 固定: `"spec-driven-dev/audit"` |
| `version` | string | Yes | 固定: `"1.0"` |
| `type` | string | Yes | 固定: `"audit_response"` |
| `verdict` | string | Yes | `"clean"`, `"findings-present"`, `"needs-user-decision"` のいずれか |
| `consistency_check.passed` | boolean | Yes | `verify_spec_consistency.py` が成功したか |
| `consistency_check.orphan_check` | boolean | Yes | orphan-check を有効にして実行したか |
| `consistency_check.output_summary` | string | Yes | 出力の要約（最大 10 行 600 文字） |
| `test_type_coverage.passed` | boolean | Yes | 全 FR/NFR にテスト 3 種別あるか |
| `test_type_coverage.missing` | object[] | No | 不足がある場合の詳細 |
| `findings` | object[] | Yes | 空配列 = 差分なし |
| `findings[].id` | number | Yes | Finding 連番 |
| `findings[].severity` | string | Yes | `"High"`, `"Medium"`, `"Low"` |
| `findings[].classification` | string | Yes | `"implementation-fix"`, `"spec-fix"`, `"needs-user-decision"` |
| `findings[].spec` | string | Yes | 対象 SPEC ID |
| `findings[].requirement` | string | Yes | 対象要件 ID |
| `findings[].summary` | string | Yes | 差分の要約 |
| `findings[].evidence` | string | Yes | 根拠 |
| `findings[].impact` | string | Yes | 影響 |
| `findings[].required_update` | string | Yes | 必要な更新内容 |
| `audit_summary` | object | Yes | 監査サマリー |

### verdict の判定基準

| verdict | 条件 |
|---|---|
| `clean` | `consistency_check.passed` = true かつ `findings` が空 かつ `test_type_coverage.passed` = true |
| `findings-present` | `findings` に `implementation-fix` または `spec-fix` がある |
| `needs-user-decision` | 全 findings が `needs-user-decision` のみ |

---

## 3. Shutdown Request（orchestrator -> auditor）

ワークフロー完了時に auditor を終了させる。

```
監査完了。ありがとうございました。終了してください。

\`\`\`json
{
  "protocol": "spec-driven-dev/audit",
  "version": "1.0",
  "type": "shutdown_request"
}
\`\`\`
```

auditor はこのメッセージを受け取ったら停止する。

---

## 4. Orchestrator の状態遷移

```
TRIAGE
  ├─ 影響不明 ──> IMPACT_ANALYSIS ──> TRIAGE（再評価）
  ├─ 仕様不足 ──> AUTHORING ──────> AUDIT_REQUEST
  ├─ 仕様あり ──> IMPLEMENTATION ─> AUDIT_REQUEST
  └─ 監査のみ ──> AUDIT_REQUEST

AUDIT_REQUEST ──(SendMessage to auditor)──> wait

AUDIT_REVIEW（auditor から response 受信）
  ├─ verdict: clean ──────────────> CLOSE_OUT
  ├─ verdict: findings-present
  │   ├─ implementation-fix のみ ──> IMPLEMENTATION ──> AUDIT_REQUEST (iteration++)
  │   ├─ spec-fix のみ ────────────> AUTHORING ──────> AUDIT_REQUEST (iteration++)
  │   ├─ 混在 ───────────────────> AUTHORING → IMPLEMENTATION ──> AUDIT_REQUEST
  │   └─ needs-user-decision ─────> CLOSE_OUT (needs-user-decision)
  └─ iteration > 3 ──────────────> CLOSE_OUT (needs-user-decision, ループ超過を残件に記載)

CLOSE_OUT
  └─ ## 最終整合性監査 を組み立て ──> Stop（hooks が検証）
```

iteration 上限（3）は無限ループ防止。超過時は `needs-user-decision` で止め、残った issues を残件に列挙する。
