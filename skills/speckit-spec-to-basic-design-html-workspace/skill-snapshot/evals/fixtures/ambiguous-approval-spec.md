# Feature Specification: 申請承認 — 登録・承認・通知

**Created**: 2026-06-25
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - 申請を承認する (Priority: P1)

申請者が申請を登録し、承認者が内容を確認して承認または却下する。

**Acceptance Scenarios**:

1. **Given** 申請内容が入力済み、**When** 申請者が登録する、**Then** 承認者へ通知される。
2. **Given** 申請が承認待ち、**When** 承認者が承認する、**Then** 申請者へ結果が通知される。

### Edge Cases

- 承認者が不在の場合は代理承認者が処理する。
- 通知に失敗した場合は適切に再送する。

## Requirements

### 申請

- **FR-001 (MUST)**: 申請者は件名、内容、希望日を入力して申請を登録できなければならない。
- **FR-002 (MUST)**: 承認者は承認待ち申請を承認または却下できなければならない。
- **FR-003 (MUST)**: システムは申請登録時と承認結果確定時に関係者へ通知しなければならない。

## Success Criteria

- **SC-001**: 申請登録から承認完了までの状況を関係者が確認できる。

## Assumptions

- 利用者と組織情報は既存の認証基盤から取得できる。

## Out of Scope

- 申請内容に応じた多段階承認は対象外とする。
