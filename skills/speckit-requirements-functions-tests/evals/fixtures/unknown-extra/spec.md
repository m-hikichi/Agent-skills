# Feature Specification: バッチ稼働監視

**Created**: 2026-08-07  
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - 遅延を検知する (Priority: P1)

運用担当者は日次バッチの開始遅延を把握する。

**Acceptance Scenarios**:

1. **Given** 予定時刻を10分超過、**When** 監視判定する、**Then** 遅延として運用担当へ通知する。

## Requirements

- **FR-001**: 日次バッチが予定時刻を10分超過しても開始していない場合、運用担当へ通知しなければならない。

## Success Criteria

- **SC-001**: 遅延条件成立から通知まで2分以内である。
