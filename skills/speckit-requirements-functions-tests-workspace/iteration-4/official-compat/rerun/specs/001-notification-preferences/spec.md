# Feature Specification: Notification preferences

**Feature Branch**: `001-notification-preferences`
**Created**: 2026-09-23
**Status**: Draft
**Input**: Controlled compatibility fixture authored after official v1.0.0 feature scaffolding. Not an agent-generated specification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Register notification destination (Priority: P1)

A signed-in user registers an email destination for notifications.

**Why this priority**: Registration is needed before notifications can be delivered.
**Independent Test**: Register alice@example.test and observe it in the destination list.
**Acceptance Scenarios**:

1. **Given** a signed-in user with no destinations, **When** the user registers alice@example.test, **Then** alice@example.test appears as enabled in the destination list.
2. **Given** alice@example.test is already registered, **When** the same user registers alice@example.test again, **Then** the destination list still contains exactly one alice@example.test entry.

### User Story 2 - Disable notification destination (Priority: P2)

A signed-in user disables an existing notification destination without removing it.

**Why this priority**: Users need to stop notifications temporarily.
**Independent Test**: Disable alice@example.test and observe its disabled state.
**Acceptance Scenarios**:

1. **Given** alice@example.test is enabled, **When** the user disables alice@example.test, **Then** its status becomes disabled and its entry remains in the destination list.

### Edge Cases

- Given alice@example.test is disabled, When the user disables it again, Then it remains disabled and exactly one entry remains.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST register an email notification destination for a signed-in user.
- **FR-002**: The system MUST reject duplicate registration of the same email notification destination for the same user.
- **FR-003**: The system MUST disable an existing email notification destination without deleting it.

### Key Entities *(include if feature involves data)*

- **Destination**: A user's email address and enabled or disabled status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 duplicate-registration trials, the destination list contains exactly one entry for each email destination after every trial.

## Assumptions

- An existing sign-in mechanism identifies the current user.
