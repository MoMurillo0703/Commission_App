# Current Data Model

## Persistence

The application uses SQLite through Drizzle ORM. `migrations/0001_foundation.sql` creates the current schema and `src/db/schema.ts` maps it for the application. Foreign keys are enabled when the database is opened. Money is stored as integer cents and compensation rates as integer basis points.

## Current tables

### `carriers`

- Stable integer ID and case-insensitive unique name.
- Referenced by commission records.

### `lines_of_business`

- Stable integer ID and case-insensitive unique name.
- Referenced by commission records.

### `groups`

- Stable integer ID, required name, optional group number and notes.
- Referenced by commission records.
- Names and group numbers are not unique. `group_number` is not carrier-scoped and must not yet be treated as a reliable import key.

### `agents`

- Stable integer ID, required name, optional default compensation rate in basis points, and notes.
- Default compensation is constrained to 0–100%.
- Agent names are not unique.

### `commission_records`

- Required statement month, group, carrier, line of business, gross commission, agent compensation, and agency net.
- Optional agent, premium, applied compensation rate, source reference, and notes.
- Group, carrier, line of business, and agent use foreign keys.
- Money is stored in integer cents.
- The database enforces `agency_net_cents = gross_commission_cents - agent_compensation_cents`.
- On creation, the service calculates one agent's compensation from an explicit commission rate or the agent default. If an agent is assigned and neither rate exists, creation is rejected for review rather than silently using 0%. An unassigned record receives zero agent compensation.
- On update, omitting compensation while retaining the same agent preserves the stored rate and compensation amount. Explicit compensation changes are recalculated and stored.
- No uniqueness constraint prevents duplicate commission records or duplicate source references.

## Required concept coverage

| Concept | Current support |
| --- | --- |
| Group / Account | Implemented as a persisted reference entity |
| Carrier | Implemented as a persisted reference entity |
| Line of Business | Implemented as a persisted reference entity |
| Agent | Implemented as a persisted reference entity |
| Agent-to-account relationship | Missing; an agent can only be attached directly to an individual commission record |
| Commission Record | Implemented for manual create/update with stable foreign keys |
| Agent Compensation | Implemented for one agent and one percentage per commission; multiple-agent allocations are not supported |
| Gross Commission | Implemented as integer cents |
| Agency Net | Implemented as gross minus agent compensation, with a database consistency check |
| Missing Commission | Missing |

## Material alignment issues

- The core scope requires an agent-to-account relationship, but no assignment table exists. Account ownership cannot provide a default agent/split or preserve effective-dated ownership independently of commission rows.
- A source reference is not unique and there is no import batch/source-row fingerprint, so duplicate posting is not prevented.
- Group and agent duplicates are possible. This can fragment reporting and make imports ambiguous.
- `statement_month` has correct API validation, but the database check only verifies a numeric `YYYY-MM` shape and does not restrict the month to `01`–`12`.
- The schema supports one agent per commission. That is suitable only for a single-agent split; do not add a second overlapping compensation representation without an explicit product decision.
- The earlier in-memory `CommissionRow` and summary functions still exist but are not the persisted source of truth. New reporting should use the normalized database records and integer-cent fields.
