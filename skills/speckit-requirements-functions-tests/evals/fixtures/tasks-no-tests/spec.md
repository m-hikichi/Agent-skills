# Feature Specification: お知らせ公開予約

**Created**: 2026-08-02  
**Status**: Ready for Planning

## User Scenarios & Testing

### User Story 1 - 公開を予約する (Priority: P1)

編集者は未来の日時を指定してお知らせの公開を予約する。

**Independent Test**: 下書きに未来日時を設定し、予約中へ変わることを確認する。

**Acceptance Scenarios**:

1. **Given** 下書きのお知らせ、**When** 未来日時で公開予約する、**Then** 状態が予約中になる。
2. **Given** 下書きのお知らせ、**When** 過去日時で公開予約する、**Then** 予約は拒否され下書きのままになる。

## Requirements

- **FR-001**: 編集者は下書きのお知らせに未来の公開日時を設定できなければならない。
- **FR-002**: 過去日時の公開予約は拒否されなければならない。
- **FR-003**: 予約日時になったお知らせは公開状態にならなければならない。

## Success Criteria

- **SC-001**: 予約日時から60秒以内に公開されるお知らせが99%以上である。
