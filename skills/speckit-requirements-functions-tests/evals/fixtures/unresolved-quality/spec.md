# Feature Specification: 購買承認

**Created**: 2026-08-04  
**Status**: Needs Clarification

## Clarifications

### Session 2026-08-04

- Q: 申請金額がいくら以上なら部長承認が必要か？ → A: [NEEDS CLARIFICATION: 金額境界と通貨が未決定]

## User Scenarios & Testing

### User Story 1 - 購買申請を承認する (Priority: P1)

承認者は権限のある購買申請を承認する。

**Acceptance Scenarios**:

1. **Given** 承認待ちの申請、**When** 権限のある承認者が承認する、**Then** 申請は承認済みになる。

## Requirements

- **FR-001**: 承認者は権限のある購買申請を承認できなければならない。
- **FR-002**: システムは部長承認が必要な申請を金額に基づいて判定しなければならない。

## Success Criteria

- **SC-001**: 承認操作の95%が1分以内に完了する。
