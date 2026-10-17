# Research: 配送依頼連携

## Decision: Transactional outbox

配送依頼の状態変更と通知イベント記録の原子性を保つためtransactional outboxを採用する。

## Decision: Delivery semantics

通知はat-least-onceとし、イベントIDによる重複排除を受信側契約に含める。
