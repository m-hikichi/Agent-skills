# Implementation Plan: 注文連携API

## Summary

外部EC向け注文登録API、注文状態の永続化、Outboxを用いた非同期状態通知、イベント隔離・手動再送、
日次件数照合を1つのサービス群として実装する。注文更新とOutbox記録を同一transactionに含め、
状態更新済みだがイベントが失われる状態を避ける。

## Technical Context

- Runtime: Node.js 22 / TypeScript 5.9
- API: Fastify 5、OpenAPI 3.1
- Database: PostgreSQL 17
- Job execution: 同一artifactをAPI process、worker process、scheduler processとして起動
- Deployment: Kubernetes、Asia/Tokyoをapplication default timezoneにせず、scheduleへ明示
- Observability: OpenTelemetry traces/metrics、構造化log、既存alert channel
- Testing: Vitest、PostgreSQL Testcontainers、contract test、E2E、k6性能試験

## System Context

- 外部ECはOAuth 2.0 client credentialsで注文登録APIを呼び出す。
- 注文連携システムは状態変更webhookを外部ECへ送信する。
- 注文連携システムは外部ECの件数取得APIを日次照合で呼び出す。
- 運用担当者は監視通知を受け、隔離イベントの手動再送を行う。

## Containers

| Container | Responsibility | Technology |
|---|---|---|
| Order API | 注文登録、冪等応答、状態変更要求、手動再送受付 | Fastify / TypeScript |
| Delivery Worker | Outbox配送、自動再送、隔離 | TypeScript worker |
| Reconciliation Scheduler | 日次件数照合と照合不能通知 | TypeScript worker |
| Order Database | 注文、冪等結果、状態履歴、Outbox、照合結果 | PostgreSQL 17 |
| Observability | metric、trace、alert | OpenTelemetry + 既存監視 |

API、worker、schedulerは同じdatabase schemaを利用する。外部ECへ直接到達できるのはworkerとschedulerだけ。

## Request and Transaction Flow

### 注文登録

1. APIはclient_idと`Idempotency-Key`を組にして既存受付結果を検索する。
2. 未登録なら注文、明細、冪等受付結果を1transactionで保存する。
3. 一意制約競合時は既存transactionの完了を待ち、保存済みの初回結果を返す。
4. 初回は201、同じkeyかつ同じpayloadの再送は200で同じ注文IDを返す。
5. 同じkeyでpayloadが異なる場合は409 `IDEMPOTENCY_CONFLICT`を返す。

### 状態変更と通知

1. Order APIは行lockを取得し、現在状態と許可遷移を検証する。
2. 注文状態、状態履歴、Outbox eventを1transactionで保存する。
3. Delivery Workerは`FOR UPDATE SKIP LOCKED`で送信待ちeventをclaimする。
4. 外部ECへ`X-Event-Id`付きwebhookを送信する。
5. 失敗時は1分、5分、15分後に再送し、3回失敗後は`dead_letter`へ移す。
6. dead-letter移行から5分以内にalertを発火する。
7. 手動再送は同じevent IDを再び`pending`にし、成功時にincidentを解消する。

### 日次照合

1. CronJob相当のschedulerが`0 2 * * *`、`Asia/Tokyo`で起動する。
2. 前日のJST日付範囲をUTCへ変換する。
3. 外部ECの件数APIと内部databaseを照会する。
4. 不一致または外部取得失敗を記録し、運用担当へ通知する。
5. 同じ対象日のjobは一意制約とadvisory lockで重複実行しない。

## State Management

状態遷移の正本は`data-model.md`のOrder State Transitionsとする。表にない遷移は409
`INVALID_STATE_TRANSITION`で拒否し、注文・履歴・Outboxを変更しない。

## Security

- 外部APIはOAuth 2.0 client credentialsとscopeで認可する。
- 手動再送APIは運用者scope `events.replay`を要求し、操作理由を監査logへ記録する。
- secretはKubernetes Secret providerから注入し、designやlogへ値を出さない。
- 配送先の個人情報はapplication logへ出さない。

## Operational Design

- Metrics: API latency、idempotency conflict、Outbox age、delivery failure、dead-letter count、reconciliation mismatch。
- Alerts: dead-letter作成から5分、Outbox最古30分、日次job未完了を検知する。
- Recovery: runbookに従い外部EC復旧を確認し、event IDと理由を指定して手動再送する。
- Migration: backward-compatible migrationを先に適用し、旧versionとの並行稼働後に制約を有効化する。
- Rollback: applicationを直前versionへ戻しても新規nullable列を読み飛ばせる。database migrationは削除しない。

## Quality Goals

- 注文登録API p95 <= 2秒（通常想定負荷、k6で測定）
- 同一client/idempotency keyの注文重複0件（並行contract/E2E test）
- Outbox未解決送信漏れ0件（自動再送・dead-letter・手動復旧E2E）
- dead-letterからalert発火まで5分以内（監視integration test）

## Project Structure

```text
src/api/
src/domain/
src/delivery-worker/
src/reconciliation/
src/observability/
migrations/
tests/contract/
tests/e2e/
```

## Gates

- `contracts/openapi.yaml`とAPI implementationのcontract testが一致する。
- `data-model.md`の全状態遷移をparameterized testで検証する。
- `quickstart.md`の主要・異常・復旧scenarioがpassする。
- OpenTelemetry、alert、runbookをstagingで確認してからproductionへ進める。
