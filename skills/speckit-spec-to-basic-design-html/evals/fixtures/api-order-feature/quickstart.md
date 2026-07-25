# Quickstart: 注文連携APIの実装検証

この手順はlocalまたはephemeral CI環境で、主要要求と障害復旧をE2E確認するための正本である。
実在するcredentialや個人情報を使用しない。

## Prerequisites

- Node.js 22
- Docker / Testcontainersを実行できる環境
- `contracts/openapi.yaml`から起動する外部EC stub
- PostgreSQL 17 test container

## Start

```bash
npm ci
npm run db:migrate:test
npm run start:test-stack
```

test stackはOrder API、Delivery Worker、Reconciliation Scheduler、PostgreSQL、外部EC stub、
in-memory alert sinkを起動する。schedule clockはtestから固定できる。

## Scenario 1: 初回受付と冪等再送

1. OAuth test clientでtokenを取得する。
2. `Idempotency-Key: idem-001`と同じrequestで`POST /v1/orders`を2回並行実行する。
3. 初回201、もう一方は201または200を受け取る。
4. 2応答の`orderId`が同じであることを確認する。
5. Order、OrderLine、IdempotencyResultが各1組だけ存在することを確認する。
6. 同じkeyでskuだけ変えたrequestが409 `IDEMPOTENCY_CONFLICT`になることを確認する。

対応: FR-001、FR-002、SC-002。

## Scenario 2: 全許可・禁止状態遷移

parameterized E2Eで次を検証する。

- accepted → shipping → delivered は成功する。
- accepted → cancelled は成功する。
- delivered → cancelled、cancelled → shipping、shipping → cancelled、同一状態への遷移は409。
- version競合は409 `VERSION_CONFLICT`。
- 拒否時にOrder、OrderStateHistory、OutboxEventが変化しない。
- 成功時は状態、History、Outboxが同じtransactionで保存される。

対応: FR-010、FR-011、Clarification 2026-06-24。

## Scenario 3: 状態通知、自動再送、隔離、手動復旧

1. 外部EC stubを500応答に固定する。
2. accepted → shippingを実行し、Outbox event IDを記録する。
3. test clockを1分、5分、15分進め、各試行が同じevent IDを使うことを確認する。
4. 3回目失敗でstatusがdead_letterになり、全attemptが記録されることを確認する。
5. test clockを5分未満進め、alert sinkにevent IDとrunbook linkが届くことを確認する。
6. 外部EC stubを204へ戻す。
7. 操作理由付きで`POST /v1/operations/events/{eventId}/replay`を呼ぶ。
8. 同じevent IDがdeliveredになり、未解決dead-letterが0件、監査記録が1件になることを確認する。
9. 外部EC stubへ同じevent IDを再度渡し、業務結果が重複しないことを確認する。

対応: FR-020、FR-021、FR-022、SC-003、SC-004。

## Scenario 4: 日次照合

1. test clockを2026-07-18 02:00 Asia/Tokyoに固定する。
2. 外部件数を10、内部件数を9にしてschedulerを実行する。
3. target_dateが2026-07-17、resultがmismatchedで通知されることを確認する。
4. 同じtarget_dateで2 workerを並行実行し、DailyReconciliationが1件だけであることを確認する。
5. 外部APIを503にし、resultがunavailable、照合不能通知が記録されることを確認する。

対応: FR-030。

## Scenario 5: 性能と観測可能性

1. k6 profile `orders-normal-load`を10分実行する。
2. `createOrder`のp95が2秒以内であることを確認する。
3. traceにAPI、database transaction、Outbox claim、webhook deliveryがevent/order IDで関連付くことを確認する。
4. logに配送先、token、secretが含まれないことを確認する。

対応: SC-001、plan Quality Goals/Security。

## Expected completion

全scenarioがpassし、未解決dead-letter、失敗中reconciliation、blocking alertが0件であること。
生成したtest dataとcredentialはtest stack終了時に破棄する。

```bash
npm run stop:test-stack
```
