# Data Model: 配送依頼連携

## DeliveryRequest

- id: UUID, primary key
- idempotency_key: string, unique
- destination: string
- status: accepted | shipping | delivered | cancelled
- version: integer

## OutboxEvent

- event_id: UUID, primary key
- request_id: UUID
- previous_status: string
- current_status: string
- occurred_at: timestamp
- attempt_count: integer
- resolution_status: pending | isolated | resolved

## State Transitions

| From | To | Guard | Side effect |
|---|---|---|---|
| accepted | shipping | 配送開始済みでない | 状態イベントをOutboxへ記録 |
| accepted | cancelled | 配送開始済みでない | 状態イベントをOutboxへ記録 |
| shipping | delivered | 配送完了が報告済み | 状態イベントをOutboxへ記録 |

表にない遷移は拒否し、状態とversionを変更しない。
