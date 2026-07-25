# 基本設計 v3 — JSON・根拠・図・品質・HTML仕様

## 目次

1. [資料レベルと正本](#1-資料レベルと正本)
2. [トップレベルスキーマ](#2-トップレベルスキーマ)
3. [根拠付き設計値](#3-根拠付き設計値)
4. [入力成果物とトレース鎖](#4-入力成果物とトレース鎖)
5. [機能とアクター](#5-機能とアクター)
6. [システム構成](#6-システム構成)
7. [重要フローと状態遷移](#7-重要フローと状態遷移)
8. [データモデル](#8-データモデル)
9. [型付きインターフェース契約](#9-型付きインターフェース契約)
10. [品質シナリオ・検証・リスク・実装要約](#10-品質シナリオ検証リスク実装要約)
11. [要求トレーサビリティと確認事項](#11-要求トレーサビリティと確認事項)
12. [4軸の資料準備度](#12-4軸の資料準備度)
13. [HTML仕様と決定的生成](#13-html仕様と決定的生成)
14. [CLI・更新・v2移行](#14-cli更新v2移行)

## 1. 資料レベルと正本

### 1.1 機能設計 (`functional-design`)

入力は`spec.md`を必須とする。要求、受入シナリオ、機能責務、業務ルール、明示済みの業務フロー・
状態、論理エンティティ、要求根拠を扱う。次は要求に明記されていない限り未確定と表示する。

- 技術スタックとコンテナ構成
- 物理DB、索引、トランザクション、排他方式
- APIのmethod/path/schema/auth、イベント配送方式
- 再試行間隔、上限到達後の復旧、監視、配置、移行

文書状態は`functional-design`であり、`implementation-ready`と表示してはならない。

### 1.2 実装準備設計 (`implementation-ready`)

次の`source.artifacts.type`を必要とする。

| type | 必須条件 | 正とする情報 |
|---|---|---|
| `spec` | 常に1件 | What/Why、受入、業務ルール、スコープ |
| `plan` | 必須 | 技術構成、制約、配置・運用方針 |
| `research` | 必須 | 技術判断、代替案、採否理由 |
| `data-model` | 必須 | エンティティ、属性、関係、状態、制約 |
| `quickstart` | 必須 | E2E確認方法、実行条件 |
| `contract` | 外部境界がある場合は1件以上 | wire形式、型、エラー、認証、配送意味論 |
| `tasks` | 任意 | フェーズ、依存、完了状況 |
| `constitution` | 任意 | 組織・プロジェクトの拘束条件 |
| `code` | 任意 | 既存実装の事実。要求の代替にはしない |

`--level auto`はdesign.jsonの`document_level`を使い、未指定なら`functional-design`とする。必要成果物が
揃っただけで自動的に実装準備へ昇格しない。ユーザーが実装準備を求めた場合に`implementation-ready`を
設定し、不足があればブロッキングエラーにする。部分的なplan一式は機能設計で参照できるが、欠落を
推測で補わず、不足一覧を表示する。

### 1.3 正本の競合

- 要求同士の未確定・矛盾は`/speckit.clarify`へ戻す。
- plan、data-model、contract等の不整合は`/speckit.analyze`へ戻す。
- 技術構成、運用、契約の欠落は`/speckit.plan`へ戻す。
- design.jsonは派生設計の正本だが、入力成果物の記載を上書きする権限を持たない。
- HTMLは表示専用であり、直接編集しない。

## 2. トップレベルスキーマ

```json
{
  "schema_version": 3,
  "document_level": "functional-design",
  "title": "注文連携 基本設計",
  "source": { "artifacts": [] },
  "meta": {
    "created_on": "2026-07-18",
    "updated_on": "2026-07-18"
  },
  "interfaces": [],
  "function_list": [],
  "architecture": {
    "context": null,
    "containers": null,
    "decisions": []
  },
  "workflows": [],
  "state_models": [],
  "applicability": {
    "workflows": { "status": "not-evaluated" },
    "state_models": { "status": "not-evaluated" }
  },
  "entities": [],
  "quality_scenarios": [],
  "risks": [],
  "verification": [],
  "traceability": [],
  "source_catalog": [],
  "requirement_decisions": [],
  "decisions": [],
  "open_questions": [],
  "delivery_summary": null,
  "report": {
    "document_status": "functional-design",
    "readiness": {},
    "errors": [],
    "warnings": []
  }
}
```

### 2.1 IDの既定

| 要素 | 形式 |
|---|---|
| 機能 | `FNC-xxx` |
| 業務ルール | `BR-xxx-xx` |
| Context/Container要素 | `SYS-xxx` / `CTR-xxx` / `EXTSYS-xxx` / `PERSON-xxx` |
| フロー | `WF-xxx` |
| ステップ | `STEP-xxx-xx` |
| 状態モデル | `STM-xxx` |
| エンティティ | `ENT-xxx` |
| インターフェース | `SCR/API/BAT/EVT/EXT/MAN-xxx` |
| 品質シナリオ | `QS-xxx` |
| リスク | `RSK-xxx` |
| 検証 | `VER-xxx` |
| 質問 | `Q-xxx` |

既存IDを名称変更、分類移動、要求追加で振り直さない。削除IDを再利用しない。新規IDは末尾へ追加する。

## 3. 根拠付き設計値

技術・業務判断を単なる文字列として確定しない。次の`design_fact`を共通形とする。

```json
{
  "id": "FACT-FNC-001-TRIGGER",
  "text": "外部ECが注文登録APIを呼び出す",
  "basis": "specified",
  "source_refs": ["spec:FR-001", "contract:contracts/openapi.yaml#/paths/~1orders/post"]
}
```

| basis | 意味 | 追加必須項目 |
|---|---|---|
| `specified` | 正本に明記 | `source_refs` |
| `derived` | 明記された複数事実から設計上導出 | `source_refs`、`rationale` |
| `confirmed` | ユーザー回答で確定 | `source_refs`、`confirmation` (`CL-xxx`) |

`source_refs`は`<artifact-type>:<locator>`とし、規範IDがあるspec項目は`spec:FR-001`のように参照する。
契約内のJSON PointerはRFC 6901形式でよい。design.json内の他要素を参照する場合は`function:FNC-001`、
`state-model:STM-001`のようにする。

次は`design_fact`または同じ`basis/source_refs/rationale/confirmation`を持つオブジェクトにする。

- 機能の起動契機、入力、出力、事前条件、事後条件、業務ルール、例外
- データ属性、制約、関係
- architectureの要素・関係・判断
- workflowの各ステップ、state modelの各遷移
- interface contractおよびそのデータ項目
- 品質シナリオ、リスク軽減策、検証方法

`derived`は「一般的だから」「ベストプラクティスだから」だけでは成立しない。要求を満たすために必要な
因果を`rationale`へ書く。method、path、HTTP status、再試行間隔、タイムゾーン、ロック方式等を
specから導出しない。planまたはcontractに無ければ未確定である。
`confirmed`のconfirmationはspecのClarificationsまたは`requirement_decisions`に存在するCL IDだけを使う。
plan/research由来の`decisions`（ADR等）は技術判断であり、ユーザー確認の代わりにならない。

## 4. 入力成果物とトレース鎖

### 4.1 `source.artifacts`

```json
{
  "source": {
    "artifacts": [
      {
        "type": "spec",
        "path": "spec.md",
        "locator": "Requirements",
        "fingerprint": "64桁の小文字SHA-256"
      },
      {
        "type": "contracts",
        "path": "contracts/openapi.yaml",
        "locator": "/paths",
        "fingerprint": "64桁の小文字SHA-256"
      }
    ]
  }
}
```

- `path`はfeatureディレクトリからの相対パスとし、`..`で外へ出ない。
- `locator`は必須。特定の見出し・JSON Pointer・行識別子を記録し、ファイル全体なら`"*"`とする。
- `fingerprint`はファイル全体のraw bytesに対するSHA-256。初回の空欄/64桁0だけ検査器が計算する。
  既存値との不一致は正本だけが変わったstale designとしてブロックし、`--write-report`でも再基準化しない。
  正本と設計を意図的に同時更新した場合だけ、該当値を空欄にして再記録する。
- 同じ相対pathを重複登録しない。必須typeの不足、未知type、存在しないpath、fingerprint不一致を検出する。
- `type=spec`は1件だけとし、検証へ渡したspec内容とそのartifact pathの正本が完全一致することを確認する。
  v3確定版はfeature directory基準を必須とし、正本ファイル検査を省略して合格させない。
- 各`source_refs`のMarkdown見出し・記載文字列と、JSON/OpenAPI/YAMLのRFC 6901 Pointerも正本内で
  実在確認する。namespaceだけ合っていても存在しないlocatorはブロックする。

### 4.2 トレース鎖

要求から検証まで次の鎖を切らない。

```text
artifact locator → source_catalog/traceability → function/design element
                 → workflow/state/data/contract → verification
```

設計要素の`source_refs`は存在するartifact locatorまたは設計IDへ解決できなければならない。
`traceability`の逆方向にも対応する機能・設計要素・検証IDを記録する。

## 5. 機能とアクター

3階層の`function_list`はExcel風の俯瞰と既存差分維持のため残す。`rows`の標準形:

```json
{
  "id": "FNC-001",
  "name": "注文登録",
  "summary": "外部ECから注文を受け付け、受付結果を返す",
  "priority": { "value": "P1", "basis": "specified", "source_refs": ["spec:US-001"] },
  "actors": {
    "initiators": ["ACT-EXTERNAL-EC"],
    "processors": ["ACT-ORDER-SERVICE"],
    "recipients": ["ACT-EXTERNAL-EC"],
    "operators": []
  },
  "trigger": {
    "text": "注文登録要求を受信する",
    "basis": "specified",
    "source_refs": ["spec:FR-001"]
  },
  "execution": { "type": "api", "refs": ["API-001"] },
  "inputs": [],
  "outputs": [],
  "preconditions": [],
  "postconditions": [],
  "business_rules": [],
  "exceptions": [],
  "data_entities": ["ENT-ORDER", "ENT-ORDER-LINE"],
  "source_refs": ["spec:FR-001", "spec:AC-001-01"],
  "status": "current"
}
```

`priority.value`は`P0|P1|P2|P3|P4|unspecified`。User Story等に明記された優先度を
`specified`で引き継ぎ、複数要求にまたがる場合は根拠と導出理由を記録する。要求に優先度が無ければ
捏造せず省略または`unspecified`とし、レビュー概要では全機能を「未指定」も含めて集計する。

### 5.1 アクターの役割

- `initiators`: 処理を開始する人・外部システム・スケジューラ
- `processors`: 責務を実行するシステムまたは人
- `recipients`: 結果、応答、通知を受け取る主体
- `operators`: 監視、復旧、手動例外処理を担う主体

「システム」「利用者」の一語へまとめず、役割を分ける。同じ主体が複数役割でもよい。

### 5.2 データ項目

`inputs`と`outputs`は次の形を使う。

```json
{
  "name": "冪等キー",
  "type": "string",
  "required": true,
  "description": "同一注文の再送を識別するキー",
  "basis": "specified",
  "source_refs": ["contract:contracts/openapi.yaml#/components/parameters/IdempotencyKey"]
}
```

`type`と真偽値`required`は常に持たせる。機能設計で型が正本に無い場合は
`type: "undetermined"`とするが、実装準備では未確定型を許さない。空欄を型推測で埋めない。

### 5.3 実行形態

許可値は`screen`、`api`、`batch`、`event`、`external-interface`、`manual`、`cross-cutting`。
前6種は同じtypeの`interfaces`を参照する。`cross-cutting`だけは参照を持たない。

## 6. システム構成

`architecture`は実装準備設計で使う。既定はSystem ContextとContainerまでとする。

```json
{
  "architecture": {
    "context": {
      "title": "注文連携 System Context",
      "elements": [
        {
          "id": "EXTSYS-EC",
          "name": "外部EC",
          "type": "external-system",
          "description": "注文を登録し状態通知を受信する",
          "basis": "specified",
          "source_refs": ["plan:System Context"]
        },
        {
          "id": "SYS-ORDER",
          "name": "注文連携システム",
          "type": "system",
          "description": "注文受付・状態通知・照合を担う",
          "basis": "specified",
          "source_refs": ["plan:System Context"]
        }
      ],
      "relationships": [
        {
          "from": "EXTSYS-EC",
          "to": "SYS-ORDER",
          "label": "注文登録API",
          "basis": "specified",
          "source_refs": ["contract:contracts/openapi.yaml#/paths/~1orders/post"]
        }
      ]
    },
    "containers": {
      "title": "注文連携 Containers",
      "elements": [
        {
          "id": "CTR-API",
          "name": "注文API",
          "type": "application",
          "description": "注文受付と状態更新を担う",
          "basis": "specified",
          "source_refs": ["plan:Container View"]
        }
      ],
      "relationships": []
    },
    "components": {
      "title": "注文API Components",
      "elements": [
        { "id": "CMP-HANDLER", "name": "OrderHandler", "type": "component", "basis": "specified", "source_refs": ["plan:Project Structure"] },
        { "id": "CMP-REPO", "name": "OrderRepository", "type": "repository", "basis": "specified", "source_refs": ["plan:Project Structure"] }
      ],
      "relationships": [
        { "from": "CMP-HANDLER", "to": "CMP-REPO", "label": "保存を依頼", "basis": "specified", "source_refs": ["plan:Project Structure"] }
      ]
    },
    "code": {
      "title": "冪等受付 Code View",
      "elements": [
        { "id": "CLS-IDEMPOTENCY", "name": "IdempotencyService", "type": "class", "basis": "specified", "source_refs": ["plan:Project Structure"] }
      ],
      "relationships": []
    },
    "decisions": [
      {
        "id": "ADR-001",
        "title": "Outboxによる状態通知",
        "decision": "状態更新と送信待ちイベントを同一DB transactionで記録する",
        "alternatives": ["同期Webhook送信"],
        "consequences": ["workerによる非同期配送と監視が必要"],
        "basis": "specified",
        "source_refs": ["research:Decision 2"]
      }
    ],
    "deployment": {
      "text": "Kubernetesへ配置する",
      "basis": "specified",
      "source_refs": ["plan:Deployment"]
    },
    "observability": {
      "text": "API遅延、Outbox滞留、dead-letterを監視する",
      "basis": "specified",
      "source_refs": ["plan:Observability"]
    },
    "recovery": {
      "text": "runbookに従い同じevent IDで手動再送する",
      "basis": "specified",
      "source_refs": ["plan:Recovery"]
    }
  }
}
```

`elements[].type`はContextで`person|system|external-system`、Containerで`application|worker|database|
queue|external-system`、Componentで`component|service|module|repository|adapter|external-system`、Codeで
`package|module|class|function|interface|external`を使う。関係の`from/to`は同じ図にあるIDへ解決する。
Contextは対象systemとperson/external-systemおよび関係、Containerは実装・保存境界を持たせる。
`summary`だけの空viewや、根拠しか持たないdeployment/observability/recoveryは実装準備を合格しない。

Component/Code図は、ユーザー要求またはplanにレビュー目的が明記された場合だけ`components`/`code`へ
同じelements/relationships形式で追加する。クラスやモジュールを推測して図を詳細化しない。

## 7. 重要フローと状態遷移

### 7.1 図を作る条件

次のいずれかがあり、表だけでは順序や責任境界を誤解しやすい代表シナリオに限る。

- 2つ以上の機能またはContainerを横断する
- 外部連携、非同期配送、再試行、補償・手動復旧がある
- 分岐または重要な異常系がある
- 状態により許可・禁止操作が変わる

単純な1画面CRUD、順序のない参照、単一責務には図を作らない。評価は`applicability`に残す。

```json
{
  "applicability": {
    "workflows": {
      "status": "not-applicable",
      "rationale": "単一画面・単一永続化境界のCRUDで、機能詳細表だけで順序と異常系を説明できるため",
      "basis": "derived",
      "source_refs": ["spec:FR-001", "spec:FR-002"]
    },
    "state_models": {
      "status": "not-applicable",
      "rationale": "業務状態による操作可否が要求されていないため",
      "basis": "derived",
      "source_refs": ["spec:FR-001", "spec:FR-002"]
    }
  }
}
```

statusは`required|not-applicable|not-evaluated`。`not-applicable`にはrationale、basis、source_refsを必須とし、
図を描画せず判断だけを品質タブへ示す。`required`なら対応配列に1件以上の完全なモデルが必要となる。

### 7.2 workflow

```json
{
  "id": "WF-001",
  "name": "注文状態変更と外部通知",
  "type": "sequence",
  "participants": [
    { "id": "P-ORDER", "name": "注文API", "role": "processor", "basis": "specified", "source_refs": ["plan:Runtime View"] },
    { "id": "P-WORKER", "name": "通知worker", "role": "processor", "basis": "specified", "source_refs": ["plan:Runtime View"] },
    { "id": "P-EC", "name": "外部EC", "role": "recipient", "basis": "specified", "source_refs": ["plan:Runtime View"] }
  ],
  "steps": [
    {
      "id": "STEP-001-01",
      "from": "P-ORDER",
      "to": "P-WORKER",
      "action": "送信待ちイベントを引き渡す",
      "next": "STEP-001-02",
      "condition": "状態更新transactionがcommit済み",
      "status": "normal",
      "basis": "specified",
      "source_refs": ["research:Decision 2", "spec:FR-020"]
    },
    {
      "id": "STEP-001-02",
      "from": "P-WORKER",
      "to": "P-EC",
      "action": "状態変更イベントを配送する",
      "status": "normal",
      "basis": "specified",
      "source_refs": ["plan:Runtime View", "spec:FR-020"]
    }
  ],
  "basis": "specified",
  "source_refs": ["spec:FR-020", "spec:FR-021"]
}
```

`type`は`activity|sequence`。`participants`は2件以上とし、各要素に一意な`id`、`name`、
`role`（`initiator|processor|recipient|operator|external-system|data-store`）と根拠を持たせる。
`steps[].from/to`はparticipant ID（`sequence`では両方必須）。直線遷移の`next`はstep ID、分岐は
`next: [{"id":"STEP-...","condition":"..."}, ...]`で表す。`status`は`normal|exception|recovery`。
省略時のstatusは`normal`とする。SVGの代替表にはstep表に加えてparticipantのID・名称・役割・根拠表を置く。

### 7.3 state model

```json
{
  "id": "STM-001",
  "name": "注文状態",
  "entity": "ENT-ORDER",
  "states": [
    { "id": "accepted", "name": "受付済み", "initial": true, "terminal": false, "basis": "specified", "source_refs": ["data-model:Order States"] },
    { "id": "delivered", "name": "配送済み", "initial": false, "terminal": true, "basis": "specified", "source_refs": ["data-model:Order States"] }
  ],
  "transitions": [
    {
      "from": "accepted",
      "to": "delivered",
      "trigger": "配送完了を受信する",
      "condition": "対象注文が受付済みである",
      "action": "状態履歴と通知イベントを記録する",
      "basis": "specified",
      "source_refs": ["spec:FR-010", "data-model:Order State Transitions"]
    }
  ],
  "unlisted_transitions": "rejected",
  "basis": "specified",
  "source_refs": ["spec:FR-010", "spec:FR-011"]
}
```

状態で操作可否が変わる要求には、全状態、初期・終端、許可遷移、禁止遷移の扱いを定義する。
各遷移はtrigger・condition・actionを明示し、無条件や副作用なしもその旨を書く。全状態は初期状態から
到達可能で、終端状態から外向き遷移を持たないことを検査する。HTTP status codeの記載だけでは
業務状態モデルを要求しない。
禁止遷移を列挙せず「表にない遷移は拒否」とする場合は、その規則を根拠付きで明記する。
状態モデルが不要なら`applicability.state_models`を`not-applicable`にする。状態を持つ要求に理由なしの
空配列は不可。

## 8. データモデル

```json
{
  "id": "ENT-ORDER",
  "name": "Order",
  "description": "外部ECから受け付けた注文",
  "basis": "specified",
  "attributes": [
    {
      "name": "idempotency_key",
      "type": "varchar(128)",
      "required": true,
      "description": "重複受付を防ぐ一意キー",
      "basis": "specified",
      "source_refs": ["data-model:Order.idempotency_key"]
    }
  ],
  "relationships": [
    {
      "to": "ENT-ORDER-LINE",
      "type": "one-to-many",
      "label": "1件以上の商品明細を持つ",
      "basis": "specified",
      "source_refs": ["data-model:Relationships"]
    }
  ],
  "constraints": [
    {
      "text": "idempotency_keyは一意",
      "basis": "specified",
      "source_refs": ["data-model:Constraints"]
    }
  ],
  "source_refs": ["spec:FR-001", "data-model:Order"]
}
```

`relationships[].type`は`one-to-one|one-to-many|many-to-many|reference`。機能設計ではspecに現れる
概念エンティティだけを作り、物理型、テーブル名、indexを推測しない。実装準備では各entityに
1件以上の属性を置き、各属性の`type`と真偽値`required`をdata-modelの記載どおり保持して、contractの
フィールド名と対応付ける。同じentity内でattribute名を重複させない。秘密情報や実データを
サンプルとして埋め込まない。

## 9. 型付きインターフェース契約

共通形:

```json
{
  "id": "API-001",
  "type": "api",
  "name": "注文登録API",
  "summary": "外部ECから注文を受け付ける",
  "actors": ["EXTSYS-EC"],
  "status": "current",
  "contract": {
    "method": "POST",
    "path": "/orders",
    "auth": "OAuth2 client credentials",
    "request": "CreateOrderRequest",
    "responses": "201 OrderAccepted",
    "errors": "400 INVALID_REQUEST / 409 IDEMPOTENCY_CONFLICT",
    "idempotency": "Idempotency-Key単位で最初の受付結果を再利用",
    "basis": "specified",
    "source_refs": ["contract:contracts/openapi.yaml#/paths/~1orders/post"]
  }
}
```

契約は詳細契約ファイルを正本とし、design.jsonへは実装・レビューに必要な要約と参照を保持する。
自由記述だけの`summary`で型付き契約を代替しない。

### 9.1 API (`type: api`)

`contract`に次を持つ。

- `method`, `path`
- `auth`: `scheme`、`scopes`または適用ルール
- `request`: headers、path/query parameters、body schema/fields
- `responses`: statusごとのschema/fields
- `errors`: code、status、condition、response
- `idempotency`: key、scope、duplicate behavior、retention
- `transaction`: boundary、rollback behavior
- `concurrency`: conflict detection、response

```json
{
  "method": "POST",
  "path": "/orders",
  "auth": { "scheme": "oauth2-client-credentials", "scopes": ["orders.write"] },
  "request": {
    "headers": [{ "name": "Idempotency-Key", "type": "string", "required": true }],
    "schema_ref": "#/components/schemas/CreateOrderRequest"
  },
  "responses": [
    { "status": 201, "schema_ref": "#/components/schemas/OrderAccepted" },
    { "status": 200, "condition": "同じ冪等キーの再送", "schema_ref": "#/components/schemas/OrderAccepted" }
  ],
  "errors": [
    { "code": "INVALID_REQUEST", "status": 400, "condition": "schema違反" }
  ],
  "idempotency": {
    "key": "Idempotency-Key",
    "scope": "external client",
    "duplicate_behavior": "最初の受付結果を返す",
    "retention": "contract記載値"
  },
  "transaction": "Orderと冪等受付結果を同一transactionでcommitし、失敗時は全rollback",
  "concurrency": "同じclient/keyは一意制約で競合検出し、確定済み結果を返す"
}
```

### 9.2 イベント (`type: event`)

`producer`、`consumers`、`trigger`、`payload`、`delivery` (`at-most-once|at-least-once|exactly-once`)、
`ordering`、`deduplication`、`retry`、`recovery`、schema/versionを持つ。再送には回数だけでなく、間隔、
終了条件、dead-letter等の隔離先、上限到達後の通知・手動復旧を含める。

### 9.3 バッチ (`type: batch`)

`schedule`、`timezone`、`initiator`、`inputs`、`outputs`、`target_range`、`overlap_policy`、
`transaction`、`retry`、`recovery`、監視・通知を持つ。「毎日02:00」だけではtimezoneが未確定である。
`retry`は少なくとも上限、間隔/backoff、上限到達時の扱いを構造化して保持する。

### 9.4 外部連携 (`type: external-interface`)

`direction`、`protocol`、`endpoint_or_channel`、`auth`、`payload`、`timeout`、`delivery`、`retry`、
`recovery`を持つ。ファイル連携はファイル名規則、encoding、delimiter、到着・再処理・重複判定も持つ。

### 9.5 画面と手動運用

- `screen`: route/view ID、入力・表示項目、権限、validation、主要action、エラー表示。詳細UI仕様を
  要求されない限り座標や装飾を捏造しない。
- `manual`: initiator、preconditions、steps、evidence、approval、failure/rollback、完了記録。
- `cross-cutting`: 機能側だけで使い、認証、監査等の適用対象と例外を根拠付きで記録する。

## 10. 品質シナリオ・検証・リスク・実装要約

### 10.1 品質シナリオ

```json
{
  "id": "QS-001",
  "category": "performance",
  "scenario": "通常負荷時に外部ECが注文登録APIを呼ぶ",
  "response": "受付結果を返す",
  "measure": "95パーセンタイル2秒以内",
  "basis": "specified",
  "source_refs": ["spec:SC-001", "plan:Performance Goals"]
}
```

categoryは`performance|availability|security|reliability|operability|maintainability|compatibility|
accessibility|other`。刺激、環境、応答、測定値が判別できない曖昧なNFRは確認事項にする。

### 10.2 検証

```json
{
  "id": "VER-003",
  "source_id": "SC-003",
  "method": "外部ECを連続失敗させ、再送とdead-letter後の手動再送をE2E試験する",
  "level": "e2e",
  "expected_result": "復旧後に未送信イベントが0件で、重複受信が業務結果を重複させない",
  "status": "planned",
  "basis": "specified",
  "source_refs": ["quickstart:Scenario 3", "spec:SC-003"]
}
```

全Success Criteriaに1件以上必要。`level`は`unit|integration|contract|e2e|performance|security|
operational|manual-review`。単に「テストする」ではなく手段と期待結果を書く。

### 10.3 リスク

```json
{
  "id": "RSK-001",
  "title": "外部EC停止による通知滞留",
  "impact": "high",
  "probability": "medium",
  "mitigation": "dead-letter、alert、runbookによる手動再送",
  "owner": "運用チーム",
  "status": "mitigated",
  "basis": "specified",
  "source_refs": ["plan:Operational Design", "research:Decision 2"]
}
```

`owner`が正本に無ければ`undetermined`とする。担当を推測しない。

### 10.4 tasks読み取り要約

```json
{
  "delivery_summary": {
    "phases": [
      { "name": "基盤", "completed": 2, "total": 4 },
      { "name": "注文受付", "completed": 0, "total": 5 }
    ],
    "dependencies": ["基盤 → 注文受付", "注文受付 → E2E検証"],
    "completed": 2,
    "total": 9,
    "basis": "specified",
    "source_refs": ["tasks:tasks.md"]
  }
}
```

tasksが無ければ`null`でタブを出さない。見積り、期限、予算、担当割当を新規作成しない。完了数は
Markdown checkboxから照合し、`Deferred`/`Future`/`Out of Scope`（延期/将来/対象外）節と`[future]`行は
現行実装の合計から除外する。

## 11. 要求トレーサビリティと確認事項

### 11.1 traceability

```json
{
  "source_id": "FR-021",
  "function_ids": ["FNC-004", "FNC-005"],
  "design_refs": ["workflow:WF-001", "interface:EVT-001"],
  "verification_ids": ["VER-003"],
  "coverage": "covered",
  "rationale": "送信、再送、復旧、E2E検証で要求を充足する"
}
```

coverageは`covered|future|out-of-scope|partial|unresolved`。確定版では`partial/unresolved`を許さない。
将来項目へ現行機能を、対象外項目へ現行設計を紐付けない。Success Criteriaは必ず`verification_ids`を持つ。

### 11.2 確認事項

```json
{
  "id": "Q-021",
  "severity": "blocking",
  "status": "open",
  "question": "3回再送後に送信漏れを解消する運用を確認してください",
  "source_refs": ["spec:FR-021", "spec:SC-003"],
  "affected_refs": ["function:FNC-005", "interface:EVT-001", "verification:VER-003"],
  "return_to": "/speckit.plan"
}
```

specのClarificationsは検査器が`source_catalog`と次の`requirement_decisions`へ自動反映する。

```json
{
  "id": "CL-20260624-02",
  "question": "状態通知が3回失敗した後は？",
  "answer": "隔離して運用担当へ通知し、同じイベントIDで手動再送する",
  "source_locator": "spec.md > Clarifications > Session 2026-06-24"
}
```

`decisions`はplan/research由来の技術・設計判断、`requirement_decisions`は確認済み要求判断として分離する。
状態は`open → answered → resolved`。回答は該当する正本へ記録し、影響設計が同じ`confirmation`を
参照した後だけresolvedにする。`affected_refs`に複数要素があれば全要素への反映が必要である。
blockingなopen/answeredがあれば該当準備軸をブロックする。

## 12. 4軸の資料準備度

単一の`quality.status`を使わない。`document_level`は入力に応じて`functional-design`または
`implementation-ready`とし、生成レポートの標準形を次とする。

```json
{
  "document_level": "implementation-ready",
  "report": {
    "document_status": "blocked",
    "readiness": {
      "requirements_coverage": {
        "status": "passed",
        "errors": [],
        "warnings": [],
        "metrics": { "normative_total": 24, "covered": 24, "percent": 100.0 }
      },
      "functional_design": {
        "status": "passed",
        "errors": [],
        "warnings": [],
        "metrics": { "functions": 7, "workflows": 2, "state_models": 1 }
      },
      "implementation_contracts": {
        "status": "failed",
        "errors": ["EVT-001: 再送上限到達後の復旧が未定義"],
        "warnings": [],
        "metrics": { "interfaces": 4, "complete_contracts": 3 }
      },
      "operational_readiness": {
        "status": "not-evaluated",
        "errors": [],
        "warnings": ["planの運用設計がない"],
        "metrics": {}
      }
    },
    "errors": [],
    "warnings": []
  }
}
```

各statusは`passed|failed|not-evaluated|not-applicable`。`document_status`は
`functional-design|implementation-ready|blocked`。機能設計ではrequirementsとfunctionalだけが
passedになり得る。後二軸は`not-evaluated`で正常だが、
レビュー概要に「実装準備完了ではない」と表示する。

### 12.1 requirements_coverage

ブロック条件:

- 規範要素がtraceabilityに無い、またはpartial/unresolved
- 設計要素と根拠の双方向参照不一致
- Markdown見出し・記載箇所、OpenAPI等のJSON Pointerが正本内に存在しない
- 根拠なし、無効なbasis、derivedのrationaleなし、confirmedの確認IDなし
- Success Criteriaにverificationがない、または手段・期待結果が空
- 現行・将来・対象外の不整合

### 12.2 functional_design

ブロック条件:

- 機能ID重複、必須責務・アクター役割・起動・入出力・条件・例外の欠落
- 複数境界を横断する重要シナリオにworkflowがなく、applicabilityもnot-applicableでない
- 状態依存要求に完全なstate modelがなく、applicabilityもnot-applicableでない
- 永続化する主要業務データに論理entityがない
- specのClarificationがdesign decisionへ反映されていない

単純CRUDへ図が無いことはエラーではない。applicabilityに根拠ある不要理由があればpassedにできる。

### 12.3 implementation_contracts

実装準備でのブロック条件:

- 必須artifact typeが不足、fingerprintが古い、成果物間が矛盾
- provenance付きelements/relationshipsを持つarchitecture context/container、またはresearchに基づく
  重要な技術判断がない
- 外部境界にOpenAPI等の正本を参照する型付きcontractがない
- 更新APIのmethod/path/auth/request/response/error/idempotency/transaction/concurrencyが未定義
- eventのproducer/consumer/trigger/payload/schema/version/delivery/ordering/deduplication/retry/recoveryが未定義
- batchのschedule/timezone/initiator/input/output/target range/overlap/transaction/retry/recovery/monitoringが未定義
- screenのroute/input/output/validation/action/auth/error、manualの起動者・前提・手順・証跡・承認・失敗・復旧・完了記録が未定義
- 状態更新・イベント記録等のtransaction境界や排他が必要なのに未定義
- 数値・方式がspecだけから捏造されている
- 必須型・契約値に`TBD`、`undetermined`、`未確定`、`要確認`等のplaceholderが残る

### 12.4 operational_readiness

実装準備でのブロック条件:

- 重要障害の監視、通知、復旧、再実行証跡がない
- 再送上限はあるが、上限到達後の隔離・通知・手動復旧がない
- 配置、設定、秘密情報、migration/rollback方針の必要事項が未定義
- quickstartに主要E2E・障害復旧確認がない
- 重要NFRのquality scenarioとverificationが対応しない

### 12.5 全軸共通診断

`report.errors/warnings`は検査器が4軸から集約する。互換用`report.status`が存在してもdeprecatedであり、
準備完了の根拠にしない。warningは責務過大、根拠が弱いderived、未所有リスク等のレビュー候補とする。

## 13. HTML仕様と決定的生成

### 13.1 タブ

データがあるものだけ次の順で表示する。

| 順 | タブ | panel id | 主な読者 |
|---:|---|---|---|
| 1 | レビュー概要 | `panel-review` | 全員・マネージャー |
| 2 | システム構成 | `panel-architecture` | 開発者 |
| 3 | 機能一覧 | `panel-functions` | 全員 |
| 4 | 機能詳細 | `panel-details` | 開発者・プログラマー |
| 5 | フロー・状態 | `panel-flows` | 開発者・プログラマー |
| 6 | データモデル | `panel-data` | プログラマー |
| 7 | インターフェース・契約 | `panel-interfaces` | プログラマー |
| 8 | 品質・検証・リスク | `panel-quality` | 全員 |
| 9 | トレーサビリティ | `panel-traceability` | 開発者・QA |
| 10 | 実装計画要約 | `panel-delivery` | マネージャー |

機能設計でもレビュー概要、機能一覧、機能詳細、品質、トレーサビリティを表示する。未確定の
architectureやcontractタブを空の推測情報で埋めない。deliveryはtasksがある場合だけ出す。

### 13.2 図

- structured JSONを正本とし、同一入力から決定的なinline SVGを生成する。
- SVG内のID、node順、座標、path順を入力順と安定IDから決め、乱数や時刻を使わない。
- 外部画像、Mermaid CDN、実行時network、foreignObjectを使わない。
- 色だけに意味を依存せず、label、marker、凡例を付ける。
- SVGへ`role="img"`、`aria-labelledby`、title/descを付ける。
- SVG直後に同じ要素・関係・step・transitionを持つHTML表を置く。
- `applicability`がnot-applicableの図は描かず理由を品質タブへ表示する。

### 13.3 共通表示

- CSS/JavaScript/SVGを内蔵した単一UTF-8 HTMLとする。
- 外部URL、inline `style`属性、環境依存font/resourceを使わない。
- タブへ`role=tablist/tab/tabpanel`、`aria-controls`、選択状態、矢印/Home/Endキー操作を実装する。
- 表にcaption、thead、`scope=col/row`を付ける。
- 機能ID、要求ID、設計ID間をページ内linkで移動できる。
- 印刷時は全パネルを順に表示し、見出し単位で改ページする。
- レビュー概要の先頭に資料レベル、document_status、4軸status、入力fingerprint、未決件数を示す。
- tasksの進捗は読み取り専用と明記する。見積り・期限・担当をdesignから生成しない。

### 13.4 鮮度と再現性

検査器は次を行う。

1. source.artifactsのpathをfeature-dir内に解決してSHA-256を比較する。
   検証へ渡されたspec本文もtype=spec artifactの本文と一致させる。
2. design.jsonから一時HTMLを再生成する。
3. 提出HTMLとバイト一致を比較する。
4. 不一致なら「古いHTML」としてエラーにし、意味が似ていても成功扱いしない。

生成時刻を本文へ埋め込まない。同じfeature成果物とdesign.jsonからはバイト同一になる。

## 14. CLI・更新・v2移行

### 14.1 CLI

```bash
# v3: feature-dirと資料レベルを自動判定
python <skill>/scripts/build_design_html.py design.json --feature-dir <specs/feature> --level auto
python <skill>/scripts/check_design_html.py <specs/feature> design.json --level auto --write-report
python <skill>/scripts/check_design_html.py <specs/feature> design.json design.html --level auto

# 資料レベルを固定
python <skill>/scripts/check_design_html.py <specs/feature> design.json --level functional-design
python <skill>/scripts/check_design_html.py <specs/feature> design.json --level implementation-ready

# v2からv3ドラフトへ
python <skill>/scripts/migrate_design.py spec.md v2-design.json -o v3-design.json
```

旧`spec.md design.json [html]`形式は互換入力として受理する。新規生成と更新ではfeature-dir形式を使う。

### 14.2 更新規則

- source artifactsの差分を最初に確認する。
- 既存のFNC、interface、workflow、state、entity IDと文言・順序を不用意に変えない。
- 規範要素を削除した場合、対応設計を黙って消さず廃止影響を確認する。
- contract更新時は機能入出力、entity、verificationへの影響を双方向に検査する。
- JSONを更新し、`report.readiness`を書き直し、HTMLを再生成してバイト一致を確認する。

### 14.3 v2からの移行

移行結果はv3ドラフトであり、次を行う。

1. `schema_version`を3へ変更する。
2. v2 `source.spec`を`source.artifacts[{type:"spec",path:...}]`へ移す。fingerprintは検査時に計算する。
3. 既存`FNC-xxx`、3階層分類、順序、名称、概要、FR、status、interface IDを維持する。
4. v2 actors配列は情報を失わず`actors.recipients`へ仮配置し、役割分離を確認事項にする。
5. trigger、input/output、pre/post、rule、exceptionの文字列を根拠付きobjectへ変換する。根拠が確定できない
   値は`basis`を捏造せずblocking questionへ送る。
6. architecture、workflow、state、entity属性型、typed contract、quality scenario、risk、verificationを
   空の推測値で補わない。specだけなら機能設計として不足を表示する。
7. v2 `quality.status`を破棄し、`report.readiness`の4軸を再計算する。旧passedを実装準備passedへ引き継がない。
8. 全Success Criteriaへverificationを割り当てる。方法が無ければrequirements軸をブロックする。
9. 状態要求と重要横断フローを評価し、model/workflowまたは根拠ある不要理由を求める。
10. v3 JSONとHTMLを生成し、既存v2 HTMLは古い派生物として置き換える。

移行で保持できない情報、矛盾、根拠不足は`open_questions`と移行レポートへ列挙する。ユーザー確認前に
勝手な技術選択や業務決定を追加しない。
