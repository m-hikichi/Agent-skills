# Data Model: 注文連携API

## Order

注文の集約root。

| Field | Type | Required | Constraint |
|---|---|---:|---|
| id | UUID | yes | primary key |
| client_id | varchar(64) | yes | OAuth client identifier |
| external_order_number | varchar(64) | yes | client内で一意 |
| idempotency_key | varchar(128) | yes | client_idとの複合一意 |
| request_hash | char(64) | yes | 正規化requestのSHA-256 |
| status | order_status | yes | accepted/shipping/delivered/cancelled |
| destination | jsonb | yes | application logへ内容を出さない |
| accepted_at | timestamptz | yes | API受付時刻 |
| version | bigint | yes | 0から始まる楽観lock version |

### Constraints

- `UNIQUE(client_id, idempotency_key)`で同一clientからの重複注文を防ぐ。
- `UNIQUE(client_id, external_order_number)`で外部注文番号の重複を検知する。
- 同じidempotency keyでrequest hashが違う場合は既存注文を返さずconflictにする。

## OrderLine

| Field | Type | Required | Constraint |
|---|---|---:|---|
| id | UUID | yes | primary key |
| order_id | UUID | yes | Order.id、delete restrict |
| sku | varchar(64) | yes | 空文字不可 |
| quantity | integer | yes | 1以上 |

Order 1件はOrderLineを1件以上持つ。

## OrderStateHistory

| Field | Type | Required | Constraint |
|---|---|---:|---|
| id | UUID | yes | primary key |
| order_id | UUID | yes | Order.id |
| from_status | order_status | no | 初回受付だけnull |
| to_status | order_status | yes | 変更後状態 |
| changed_at | timestamptz | yes | 状態変更時刻 |
| trigger_ref | varchar(128) | yes | 出荷・配送・取消処理の参照ID |

## IdempotencyResult

| Field | Type | Required | Constraint |
|---|---|---:|---|
| client_id | varchar(64) | yes | primary key part 1 |
| idempotency_key | varchar(128) | yes | primary key part 2 |
| request_hash | char(64) | yes | request一致判定 |
| order_id | UUID | yes | Order.id |
| response_status | integer | yes | 初回status |
| response_body | jsonb | yes | 初回受付結果 |
| created_at | timestamptz | yes | 保存時刻 |

## OutboxEvent

| Field | Type | Required | Constraint |
|---|---|---:|---|
| event_id | UUID | yes | primary key、全再送で不変 |
| order_id | UUID | yes | Order.id |
| event_type | varchar(64) | yes | `order.status.changed.v1` |
| payload | jsonb | yes | contract schemaに一致 |
| delivery_status | delivery_status | yes | pending/sending/delivered/dead_letter |
| attempt_count | integer | yes | 0..3 |
| next_attempt_at | timestamptz | no | pending時に指定 |
| last_error_code | varchar(64) | no | 秘密・個人情報を含めない |
| delivered_at | timestamptz | no | 成功時刻 |
| locked_at | timestamptz | no | worker lease開始 |
| locked_by | varchar(128) | no | worker instance ID |

### Constraints

- `attempt_count`は自動送信試行だけを数え、3を超えない。
- 3回目の失敗transactionで`dead_letter`へ変更し、alert対象時刻を記録する。
- 手動再送は同じ`event_id`のstatusをpendingへ戻し、監査記録を追加する。新しいeventを作らない。
- workerは`FOR UPDATE SKIP LOCKED`とlease timeoutで同時claimを防ぐ。

## DeliveryAttempt

| Field | Type | Required | Constraint |
|---|---|---:|---|
| id | UUID | yes | primary key |
| event_id | UUID | yes | OutboxEvent.event_id |
| attempt_kind | attempt_kind | yes | initial/automatic/manual |
| attempted_at | timestamptz | yes | 開始時刻 |
| result | delivery_result | yes | succeeded/failed |
| response_status | integer | no | HTTP responseがある場合 |
| error_code | varchar(64) | no | 秘密・個人情報を含めない |
| operator_reason | varchar(512) | no | manual時に必須 |

## DailyReconciliation

| Field | Type | Required | Constraint |
|---|---|---:|---|
| target_date | date | yes | primary key、Asia/Tokyoの業務日 |
| external_count | integer | no | 取得不能時null |
| internal_count | integer | yes | 0以上 |
| result | reconciliation_result | yes | matched/mismatched/unavailable |
| executed_at | timestamptz | yes | 実行時刻 |
| notified_at | timestamptz | no | mismatched/unavailable時 |

## Relationships

- Order 1 — N OrderLine
- Order 1 — N OrderStateHistory
- Order 1 — 1 IdempotencyResult
- Order 1 — N OutboxEvent
- OutboxEvent 1 — N DeliveryAttempt

## Order State Transitions

初期状態は`accepted`。`delivered`と`cancelled`は終端状態。表にない遷移はすべて拒否し、Order、
OrderStateHistory、OutboxEventを変更しない。

| From | To | Trigger | Guard | Side effects |
|---|---|---|---|---|
| (new) | accepted | 注文登録commit | 注文requestが有効 | Orderと初回Historyを保存 |
| accepted | shipping | 出荷完了 | version一致 | Order、History、Outboxを同一transactionで保存 |
| accepted | cancelled | 取消承認 | version一致 | Order、History、Outboxを同一transactionで保存 |
| shipping | delivered | 配送完了 | version一致 | Order、History、Outboxを同一transactionで保存 |

禁止遷移は409 `INVALID_STATE_TRANSITION`、version競合は409 `VERSION_CONFLICT`を返す。

## Transaction Boundaries

- 注文登録: Order、OrderLine、IdempotencyResultを1transactionでcommitする。
- 状態変更: Order row lock、OrderStateHistory、OutboxEventを1transactionでcommitする。
- 配送claim: claim更新だけを短いtransactionにし、外部HTTP中はdatabase transactionを保持しない。
- 配送結果: OutboxEventとDeliveryAttemptを1transactionで更新する。
- 日次照合: 対象日のadvisory lockを取得し、DailyReconciliationをupsertする。

## Retention

- Order、OrderLine、StateHistory: 7年。
- IdempotencyResult: 30日。期間経過後の同じkeyは新規要求として扱う。
- OutboxEvent、DeliveryAttempt: 90日。ただし未解決dead-letterは解決後90日まで削除しない。
- DailyReconciliation: 2年。
