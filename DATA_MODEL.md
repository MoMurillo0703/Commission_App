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
- On creation, the service uses an explicit commission rate or the effective-dated group/agent/LOB agreement for the paid month. No agreement means no compensation; deprecated group-wide and agent-wide defaults are not used.
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
| Agent Compensation | Implemented for one agent and one percentage per commission; multiple-agent allocations are not supported |
| Gross Commission | Implemented as integer cents |
| Agency Net | Implemented as gross minus agent compensation, with a database consistency check |
| Missing Commission | Missing |

## Material alignment issues

- Group and agent duplicates are possible. This can fragment reporting and make imports ambiguous.
- Primary group assignments are current-state fields rather than effective-dated assignment history. Historical commission records remain stable because they store their own agent and compensation snapshot.
- The schema supports one agent per commission. That is suitable only for a single-agent split; do not add a second overlapping compensation representation without an explicit product decision.
- The earlier in-memory `CommissionRow` and summary functions still exist but are not the persisted source of truth. New reporting should use the normalized database records and integer-cent fields.
