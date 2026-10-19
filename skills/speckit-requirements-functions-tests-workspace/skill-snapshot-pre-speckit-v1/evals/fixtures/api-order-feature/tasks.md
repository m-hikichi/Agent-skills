# Tasks: 注文連携API

このファイルは実装進捗と依存関係の正本である。基本設計HTMLはフェーズ、依存、完了数だけを要約し、
日程・見積り・担当割当を補完しない。

## Dependencies

```text
Phase 1 → Phase 2 → Phase 3
Phase 1 → Phase 4
Phase 2 → Phase 5
Phase 3 → Phase 5
Phase 4 → Phase 5
```

## Phase 1 - Foundation

- [x] T001 PostgreSQL test環境とmigration runnerを用意する
- [x] T002 OpenAPI contract validationをCIへ追加する
- [ ] T003 OAuth test clientとscope検証を実装する
- [ ] T004 OpenTelemetry trace/metric共通設定を実装する

## Phase 2 - Order Acceptance and State

- [ ] T010 Order、OrderLine、IdempotencyResult migrationを実装する [depends: T001]
- [ ] T011 注文登録transactionと冪等競合処理を実装する [depends: T003,T010]
- [ ] T012 注文登録contract testを実装する [depends: T002,T011]
- [ ] T013 状態遷移表とrow/version lockを実装する [depends: T010]
- [ ] T014 許可・禁止遷移parameterized testを実装する [depends: T013]

## Phase 3 - Event Delivery and Recovery

- [ ] T020 OutboxEventとDeliveryAttempt migrationを実装する [depends: T001]
- [ ] T021 状態変更とOutboxの同一transactionを実装する [depends: T013,T020]
- [ ] T022 worker claimと1/5/15分再送を実装する [depends: T020,T004]
- [ ] T023 dead-letter alertと手動再送監査を実装する [depends: T022]
- [ ] T024 webhook contract testを実装する [depends: T002,T022]

## Phase 4 - Daily Reconciliation

- [ ] T030 DailyReconciliation migrationを実装する [depends: T001]
- [ ] T031 Asia/Tokyo schedulerと重複実行防止を実装する [depends: T030,T004]
- [ ] T032 不一致・取得不能通知を実装する [depends: T031]

## Phase 5 - Verification and Release Readiness

- [ ] T040 quickstart Scenario 1と2を自動化する [depends: T012,T014]
- [ ] T041 quickstart Scenario 3を自動化する [depends: T023,T024]
- [ ] T042 quickstart Scenario 4を自動化する [depends: T032]
- [ ] T043 k6性能試験とPII log検査を実行する [depends: T040,T041]
- [ ] T044 stagingでalertとrunbookによる手動復旧を確認する [depends: T041,T043]

## Deferred

- [ ] T900 FR-040 注文変更履歴検索API [future]
