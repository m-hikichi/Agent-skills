---
name: speckit-spec-to-basic-design-html
description: >-
  GitHub Spec Kit の spec.md または同等の要求仕様から、要求根拠と実装可能な機能詳細を持つ
  基本設計書を、git管理可能な *.design.json と自己完結HTMLとして生成・更新する。
  FRだけでなく受入シナリオ、Edge Cases、Clarifications、Assumptions、成功基準、対象外まで
  双方向トレースし、根拠不足・矛盾・未確定事項はユーザー確認後にspecへ追記してから確定する。
  「機能一覧を作って」「specを基本設計へ落として」「要求が機能で実現できるか確認して」
  「Excelの機能一覧をgitレビュー可能にして」「既存の機能一覧を更新して」などで使う。
  Excel(.xlsx)自体が必須の依頼には使わない。
---

# Spec Kitから設計品質を検証できる機能一覧を作る

## 成果物と正本

役割を混同しない。

1. `spec.md` — 要求の正本。ユーザー確認で確定した要求・業務ルールはClarificationsへ記録する。
2. `<対象>_基本設計_機能一覧.design.json` — specから導出した設計の正本。安定した機能ID、設計詳細、根拠、カバレッジを持つ。
3. `<対象>_基本設計_機能一覧.html` — JSONから決定的に生成するレビュー・共有用表示。直接編集しない。

HTMLだけを更新すると設計データと表示が乖離する。更新は必ずJSONを変更して再生成する。

## 必須ワークフロー

### 1. 入力と既存成果物を確認する

- `spec.md`を全文読む。補足として指定された`plan.md`等は、specと矛盾しない範囲だけ参照する。
- 同じフォルダにv2 `*.design.json`があれば読み、既存の`FNC-xxx`、分類、文言、並び順を維持する。
- 旧JSONまたはHTMLしかなければ、先に移行する。

```bash
python <skill>/scripts/migrate_design.py spec.md 旧成果物 -o <対象>_基本設計_機能一覧.design.json
```

移行結果はドラフトであり、不足情報を`open_questions`に持つ。確認せず確定版として扱わない。

### 2. specの規範要素をすべて追跡する

対象はFRだけではない。

- Functional Requirements
- User Stories
- Acceptance Scenarios / Acceptance Criteria
- Edge Cases
- Clarifications
- Assumptions
- Success Criteria
- Out of Scope

各要素を`traceability`に1件ずつ置き、`covered`、`future`、`out-of-scope`のいずれかへ確定する。
`partial`と`unresolved`は作業中だけ許可し、確定版では品質エラーにする。

明示IDがない要素には、文書順で`US-xxx`、`AC-xxx-xx`、`EC-xxx`、`ASM-xxx`、`OOS-xxx`を付ける。
品質検査が保存する`source_catalog`の本文fingerprintを使い、項目の途中挿入・移動後も既存IDを維持する。
新規項目は同種IDの末尾へ追加し、既存IDを振り直さない。複数行の要求・受入シナリオは継続行を
同じ規範要素として扱う。

### 3. 機能を設計する

各機能は、業務上独立して説明・受入確認できる責務で切る。入力、DB読込、保存、完了表示のような
実装手順を機械的に別機能へ分けない。FR件数との固定比率で合否を決めない。

別機能にする根拠:

- 独立した業務判断または状態遷移
- 独立したアクター、起動契機、入出力
- API、バッチ、イベント、外部連携など実行境界が異なる
- 単独で受入確認・失敗処理を定義できる

各機能に変更後も維持する`FNC-xxx`を付ける。既存IDは名称変更や分類移動でも変更しない。

必須設計項目:

- `name` / `summary`
- `actors`
- `trigger`
- `execution.type`と`execution.refs`
- `inputs` / `outputs`
- `preconditions` / `postconditions`
- `business_rules`
- `exceptions`
- `data_entities`
- `source_refs`
- `status` (`current` / `future`)

実行形態は次の列挙値を使う。

| type | 用途 |
|---|---|
| `screen` | 利用者が画面から操作する |
| `api` | API要求で起動する |
| `batch` | 定時・一括処理 |
| `event` | イベント受信で起動する |
| `external-interface` | 外部システムとのファイル・メッセージ連携 |
| `manual` | システム外を含む手動運用 |
| `cross-cutting` | 認証・監査など複数接点に横断適用する |

画面、API、バッチ等は`interfaces`マスタへ登録する。`cross-cutting`だけは参照先を持たない。

### 4. 根拠と設計判断を分離する

業務ルールは文字列ではなくオブジェクトで記録する。

```json
{
  "id": "BR-021-01",
  "text": "指定期間の利用可能数を超える予約を拒否する",
  "basis": "specified",
  "source_refs": ["FR-021", "AC-001-02"]
}
```

`basis`の意味:

- `specified` — specに明記されている。根拠IDを必ず付ける。
- `derived` — 要求を実現するため設計上導出した。根拠IDと`rationale`を必ず付ける。
- `confirmed` — ユーザー回答で確定した。`CL-xxx`または確認済み決定IDを必ず付ける。

要求にない数値、期限、既定値、エラー挙動、状態、権限、実行時刻を推測で確定しない。
品質検査は「適切に」「必要に応じ」「代理承認者」の決定方法、失敗通知の無制約な再送など、
代表的な曖昧表現も検出する。検出結果は一般論で埋めず、確認回答へ結び付ける。

### 5. 未確定事項をユーザーへ確認する

品質に影響する曖昧さを見つけたら、ファイルを確定する前に質問する。

- 根拠箇所と影響する機能を示す。
- 2〜3個の具体的な選択肢と推奨案を示す。
- 関連質問はまとめ、回答しやすくする。
- 回答がない間は`open_questions`に`severity: blocking`で残す。
- 回答前に確定版HTMLを生成しない。必要なら`--allow-draft`で明確にドラフト表示する。

回答後は、質問IDを指定して`spec.md`と`design.json`へ同時記録する。

```bash
python <skill>/scripts/update_spec_clarification.py spec.md \
  --design <対象>_基本設計_機能一覧.design.json \
  --question-id Q-xxx --answer "ユーザーの回答" --date YYYY-MM-DD
```

この時点の質問状態は`answered`であり、品質ゲートは引き続き停止する。発行された`CL-xxx`を
影響する機能、業務ルール、トレーサビリティから参照し、設計内容を回答に合わせて更新した後だけ
次を実行する。

```bash
python <skill>/scripts/update_spec_clarification.py spec.md \
  --design <対象>_基本設計_機能一覧.design.json --question-id Q-xxx --resolve
```

`resolved`にした質問は、影響機能が同じ`CL-xxx`を参照していることも検査される。回答を機能一覧だけへ
書き、specへ戻さない二重管理は禁止する。

### 6. 品質検証してからHTMLを生成する

```bash
python <skill>/scripts/check_design_html.py spec.md <対象>_基本設計_機能一覧.design.json --write-report
python <skill>/scripts/build_design_html.py <対象>_基本設計_機能一覧.design.json --spec spec.md
python <skill>/scripts/check_design_html.py spec.md <対象>_基本設計_機能一覧.design.json <対象>_基本設計_機能一覧.html
```

ブロッキングエラーを0件にする。警告は内容をレビューし、妥当なら残してよい。

品質ゲートが拒否するもの:

- specの規範要素の未追跡
- 根拠のない機能または業務ルール
- `partial` / `unresolved`、ブロッキング確認事項
- 重複・不正な機能ID、無効な根拠・インターフェース参照
- 実行形態とインターフェース種別の不一致
- 現行機能と将来・対象外要求の不整合
- 導出理由のない`derived`、確認回答参照のない`confirmed`
- 根拠区分・導出理由・確認回答参照がない例外処理
- 未確認の曖昧表現（程度・時期、代理者決定、再送回数・間隔・終了条件）
- JSONとトレーサビリティの双方向参照不一致
- 回答済みだが設計へ未反映の質問、または確認回答を参照しない解決済み質問

警告としてレビューするもの:

- 出力・事後状態がなく、完了条件を確認しづらい機能
- 対象データがなく、責務が曖昧な機能
- 業務ルールが多く、責務過大の可能性がある機能

## HTMLの構成

- **機能一覧** — 大・中・小分類、機能ID、名称、概要、アクター、実行形態、根拠、提供状態を俯瞰する。
- **機能詳細** — 入出力、条件、業務ルール、例外、対象データを`FNC-xxx`単位で示す。
- **トレーサビリティ** — specの全規範要素と機能・カバレッジの対応を示す。
- **インターフェース** — 画面、API、バッチ、イベント、外部連携、手動接点を一覧化する。
- **確認・品質情報** — 種別ごとの網羅率、エラー、警告、確認待ち、確認済み決定を示す。

HTMLはCSS/JavaScript内蔵の単一ファイルで、外部URLとインライン`style`属性を使わない。
タブはキーボード操作とARIAに対応する。主表は検索・状態・実行形態で絞り込める。

## 更新時の規則

- `spec.md`の変更を最初に確認し、既存`design.json`との差分を取る。
- 既存の`FNC-xxx`、分類、文言、インターフェースIDを不用意に変更しない。
- 削除された要求に対応する機能を黙って消さず、影響と提供状態を確認する。
- 新しい規範要素をトレーサビリティへ追加し、対応機能を設計する。
- JSON更新後に品質レポートとHTMLを再生成する。
- HTMLの差分ではなく、主にJSONの意味差分をレビューする。

## 参照ファイル

- `references/format_spec.md` — v2 JSONスキーマ、カバレッジ、HTML仕様、完全な例。
- `scripts/design_quality.py` — spec抽出、v1正規化、品質ゲートの共通実装。
- `scripts/check_design_html.py` — spec・JSON・HTMLの検査。
- `scripts/migrate_design.py` — 旧JSON・旧HTMLからv2ドラフトへの移行。
- `evals/fixtures/api-order-design.json` — API・イベント・バッチ・状態遷移の意味回帰用v2設計例。
