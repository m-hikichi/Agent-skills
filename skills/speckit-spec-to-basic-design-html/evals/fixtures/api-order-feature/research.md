# Research: 注文連携API

## Decision 1: PostgreSQL一意制約で冪等受付を保証する

**Decision**: `(client_id, idempotency_key)`へ一意制約を設け、受付結果とrequest hashを保存する。

**Rationale**: API processが複数replicaでもdatabaseが競合を直列化でき、FR-002とSC-002を同じ仕組みで
保証できる。同じkeyでpayloadが異なる場合はrequest hashで検知して409を返す。

**Alternatives considered**:

- process内cache: replica間で共有されず再起動で失われるため不採用。
- Redis lockのみ: lock失効とdatabase commitの境界が増えるため、正しさの根拠には使わない。

## Decision 2: Transactional Outboxで状態変更イベントを保存する

**Decision**: 注文状態、状態履歴、Outbox eventを同じPostgreSQL transactionでcommitし、workerが非同期送信する。

**Rationale**: 状態だけ更新され通知記録が失われるdual-writeを避け、FR-020とSC-003を検証可能にする。

**Alternatives considered**:

- transaction中の同期webhook: 外部EC停止が注文状態更新を長時間blockするため不採用。
- database CDC: 現行運用基盤にCDCがなく、導入範囲が本featureを超えるため不採用。

## Decision 3: at-least-once配送とevent ID重複排除

**Decision**: webhookはat-least-onceで配送し、再送時も同じevent IDを使う。外部ECはevent IDで重複排除する。

**Rationale**: network timeout時に相手の受信成否を確定できないため、exactly-once transportは保証できない。
specのAssumptionと契約に重複排除責任を明記する。

## Decision 4: 段階的自動再送とdead-letter後の手動復旧

**Decision**: 1分、5分、15分の3回再送後にeventをdead-letterへ移し、5分以内にalertする。運用者は
原因解消後に同じevent IDを手動再送する。

**Rationale**: Clarificationの回数・間隔・復旧をそのまま実装し、SC-003を「自動再送の成功」だけに
狭めず、最終的な未解決0件として検証する。

**Alternatives considered**:

- 無期限再送: 恒久エラーを隠してqueueを圧迫するため不採用。
- 3回失敗で破棄: SC-003を満たせないため不採用。

## Decision 5: 日次jobをJST scheduleと対象日一意制約で守る

**Decision**: `0 2 * * *`、`Asia/Tokyo`で前日JSTを対象にし、`target_date`へ一意制約を置く。

**Rationale**: host timezoneへの依存と多重起動による重複通知を避け、FR-030の「毎日02:00」を明確にする。

## Unresolved Research

なし。将来対応FR-040の検索方式・保持期間はv1実装範囲外のため決定しない。
