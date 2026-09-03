# Current Data Model

## Persistence

The application uses Postgres through Drizzle ORM. Numbered SQL files in `migrations/` create the current schema; tests use PGlite. Supabase provides hosted Postgres. Money is stored as integer cents and compensation rates as integer basis points.

## Current tables

### `carriers`

- Stable integer ID and case-insensitive unique name.
- Referenced by statements and commission records.

### `lines_of_business`

- Stable integer ID and case-insensitive unique name.
- Referenced by commission records.

### `groups`

- Stable integer ID, required name, optional group number and notes.
- Referenced by commission records.
- Optionally references one primary account manager and one primary agent. Assignment alone does not create compensation.
- Names and group numbers are not unique. `group_number` is not carrier-scoped and must not yet be treated as a reliable import key.

### `agents`

- Stable integer ID, required name, optional default compensation rate in basis points, and notes.
- Default compensation is constrained to 0–100%.
- Agent names are not unique.

### `account_managers`

- Stable integer ID and case-insensitive unique name.
- May be assigned to groups independently of compensation.
- Account managers and agents do not share a person ID. Equal display names must not be treated as proof that two role records belong to the same person.

### `group_compensation_agreements`

- Effective-dated positive compensation rate for one group, one agent, and one line of business.
- Active effective periods cannot overlap for the same group and line of business, regardless of agent.
- No agreement represents no compensation.
- Kept for historical compatibility. New compensation terms are stored as `compensation_allocations`.

### `teams`

- Reusable named team with active/inactive status.
- Team members are people from the existing People directory (agent or account manager records), each with an internal share and effective dates.
- Member shares for an active team period must total 100%.

### `compensation_allocations`

- Complete compensation terms for one group, one line of business, and an effective period.
- Contains multiple `compensation_allocation_entries`: Agency (first-class), up to 3 people, and/or teams.
- Active allocations must total exactly 100% and cannot overlap for the same group and line.
- Changing terms closes the prior period and inserts a new allocation. Historical rows are not overwritten.
- Migration `0004` preserves every legacy agreement as its source and copies only the known Person share. A legacy 100% active agreement can be activated deterministically; every partial legacy agreement remains inactive and requires explicit review/completion. No Agency remainder is inferred.

### `commission_payouts`

- Posted snapshot of each recipient’s share of a commission, including expanded team members.
- Later team, percentage, or assignment changes do not rewrite these rows.
- Canonical Agency Net is the explicit Agency allocation. When an allocation totals 100%, that equals gross minus non-Agency compensation.

### `import_statements`

- Stores paid month, carrier, original filename, storage path, source type, status, mapping/preview data, optional PDF extraction path, optional statement-layout version reference, and a unique file fingerprint.
- Posted source rows are uniquely protected by statement ID and source-row key on commission records.

### `carrier_statement_layouts`

- Stores versioned Carrier layout signatures and column mappings used to recognize later readable statements; the application service creates a new version instead of editing a mapping in place.
- A statement records the exact layout ID and version used; material mapping changes create another version rather than rewriting the prior row.

### `commission_records`

- Required statement month, group, carrier, line of business, gross commission, agent compensation, and agency net.
- Optional agent, premium, applied compensation rate, source reference, and notes.
- Group, carrier, line of business, and agent use foreign keys.
- Money is stored in integer cents.
- The database enforces `agency_net_cents = gross_commission_cents - agent_compensation_cents`.
- On creation, the service uses an explicit commission rate, else the effective-dated group/LOB allocation for the paid month. During legacy compatibility, an applicable legacy agreement preserves its known Person compensation and header Agency Net under the prior single-rate behavior, but does not fabricate an Agency payout recipient. No allocation or agreement means 100% Agency. Deprecated group-wide and agent-wide defaults are not used.
- On update, omitting compensation while retaining the same agent preserves the stored rate and compensation amount. Explicit compensation changes are recalculated and stored.
- Imported rows are protected from duplicate posting by statement ID and source-row key.

## Required concept coverage

| Concept | Current support |
| --- | --- |
| Group / Account | Implemented as a persisted reference entity |
| Carrier | Implemented as a persisted reference entity |
| Line of Business | Implemented as a persisted reference entity |
| Agent | Implemented as a persisted reference entity |
| Agent-to-account relationship | One primary agent may be assigned directly to a group; compensation remains separate |
| Commission Record | Implemented for manual create/update with stable foreign keys |
| Agent Compensation | Implemented as a 100% allocation across Agency, people, and teams, with posted payout snapshots |
| Gross Commission | Implemented as integer cents |
| Agency Net | Canonical value is the explicit Agency allocation; the database still enforces `agency_net_cents = gross_commission_cents - agent_compensation_cents`, where agent compensation is all non-Agency distributed amounts |
| Missing Commission | Missing |

## Material alignment issues

- Group and agent duplicates are possible. This can fragment reporting and make imports ambiguous.
- Primary group assignments are current-state fields rather than effective-dated assignment history. Historical commission records remain stable because they store their own agent and compensation snapshot.
- The schema still stores one optional assigned agent on the commission header. Pay is stored in `commission_payouts` so multiple recipients and teams can be reported without rewriting history.
- The earlier in-memory `CommissionRow` and summary functions still exist but are not the persisted source of truth. New reporting should use the normalized database records and integer-cent fields.
