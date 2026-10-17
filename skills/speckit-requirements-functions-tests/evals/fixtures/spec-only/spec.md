# Feature Specification: チーム通知設定

**Created**: 2026-08-01  
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - 通知先を登録する (Priority: P1)

チーム管理者は、障害通知を受け取るメールアドレスを登録する。

**Independent Test**: 通知先が未登録のチームにメールアドレスを登録し、一覧へ表示されることを単独で確認できる。

**Acceptance Scenarios**:

1. **Given** 通知先が未登録、**When** 有効なメールアドレスを登録する、**Then** 通知先一覧に登録値が表示される。
2. **Given** 通知先が未登録、**When** `invalid` を登録する、**Then** 入力エラーとなり保存されない。

### Edge Cases

- 同じメールアドレスを同一チームへ二重登録した場合は重複として拒否する。

## Requirements

- **FR-001**: チーム管理者は通知先メールアドレスを登録できなければならない。
- **FR-002**: システムはメールアドレス形式でない入力を保存してはならない。
- **FR-003**: システムは同一チーム内の通知先重複を拒否しなければならない。

## Success Criteria

- **SC-001**: 初めて操作する管理者の90%以上が2分以内に通知先登録を完了できる。

## Out of Scope

- SMSおよびチャットサービスへの通知。
