# Implementation Plan: 配送依頼連携

## Technical Context

- Runtime: Python 3.13
- API: HTTP/JSON
- Storage: PostgreSQL 17
- Messaging: transactional outbox worker
- Testing: pytest, contract tests, integration tests

## Architecture

APIは配送依頼とOutboxレコードを同一トランザクションで保存する。workerは未送信Outboxを取得して倉庫システムへ通知する。状態更新はversionによる楽観ロックを使用する。

## Non-Functional Verification

- SC-001は同一条件で1,000リクエストを投入し、p95が2秒以内であることを測る。
- SC-003は3回目の失敗時刻から通知受信時刻までを記録し、5分以内であることを測る。
