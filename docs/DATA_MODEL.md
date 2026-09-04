# Data Model

Authoritative owner: **Ben**. Implementation follows this file; product meaning of the fields is in [`BUSINESS_RULES.md`](BUSINESS_RULES.md).

## Persistence

Postgres via Drizzle. Numbered SQL in `/migrations` is the schema source. Tests use PGlite. Production is Supabase Postgres.

Money: integer cents. Rates: integer basis points.

Row-level security is enabled on application tables. Browser clients do not query these tables; the Next.js server uses the database URL.

## Migrations (0001–0006)

| File | Role |
| --- | --- |
| `0001_postgres_foundation.sql` | Core reference tables, commissions, import statements, legacy agreements |
| `0002_deployment_integrity.sql` | Paid-month checks, RLS, tighter integrity |
| `0003_statement_resolve_and_layouts.sql` | Carrier statement layouts, statement layout/extraction columns |
| `0004_compensation_allocations.sql` | Teams, allocations, entries, payouts; copies legacy agreements without inferring Agency remainder |
| `0005_direct_person_limit.sql` | Active allocation: at most five direct Person entries |
| `0006_carrier_coverage_aliases.sql` | Carrier-scoped statement coverage label → LOB |

Do not rewrite an applied migration. Add a new numbered file. Runtime code must not apply these files. See [`DEPLOYMENT.md`](DEPLOYMENT.md).

Historical SQLite SQL under `migrations/sqlite/` is reference only and is not applied.

## Tables

### `carriers`

Stable integer ID, case-insensitive unique name. Referenced by statements, commissions, layouts, and coverage aliases.

### `lines_of_business`

Stable integer ID, case-insensitive unique name.

### `groups`

Stable integer ID, required name, optional group number and notes. Optional current `account_manager_id` and `primary_agent_id`. Assignment does not create compensation.

Names and group numbers are **not** unique. `group_number` is not carrier-scoped and is not a reliable import key.

Deprecated: `default_compensation_bps`. Not used as a settlement fallback. Not auto-migrated into allocations.

### `agents`

Stable integer ID, required name, optional notes. Names are not unique.

Deprecated: `default_compensation_bps`. Constrained 0–100% if present. Not a settlement fallback.

### `account_managers`

Stable integer ID, case-insensitive unique name. Agents and account managers do **not** share a person ID. Matching display names are not the same person.

### `group_compensation_agreements`

Legacy effective-dated Person rate for one group, one agent, one LOB. Active periods cannot overlap for the same group and LOB regardless of agent. Kept for compatibility. New terms are `compensation_allocations`.

### `teams` / `team_memberships`

Reusable team. Members are agent or account-manager records with internal `share_bps` and effective dates. Active member shares must total 10,000 bps.

### `compensation_allocations` / `compensation_allocation_entries`

Complete Group + LOB + effective period plan. Entries: Agency, Person (≤5 direct), and/or Team. Active allocations total exactly 10,000 bps and cannot overlap for the same group and LOB.

`source_agreement_id` points at a legacy agreement when `0004` copied it. Partial legacy copies stay inactive until completed. No Agency remainder was inferred.

Changing terms closes the prior period and inserts a new row. Historical allocation rows are not overwritten.

### `commission_records`

Required: `statement_month` (paid month), group, carrier, LOB, gross cents, agent-compensation cents, agency-net cents. Optional: header `agent_id`, premium cents, applied bps, source reference, notes, premium month, import statement, source-row key.

Database enforces `agency_net_cents = gross_commission_cents - agent_compensation_cents`.

Unique posted import identity: (`import_statement_id`, `source_row_key`) when both are present.

Header `agent_id` is a leftover single-producer slot. Pay is in `commission_payouts`.

### `commission_payouts`

Posted snapshot per recipient, including expanded team members. Later term or assignment changes do not rewrite these rows. Canonical Agency Net is the Agency payout when a complete allocation existed at post.

### `import_statements`

Paid month, optional carrier, original and display names, source type, status, unique `fingerprint`, preview and mapping JSON, optional storage path, extraction path, layout id/version, row counts.

### `carrier_statement_layouts`

Versioned carrier layout signature + column mapping. Material mapping changes create a new version. A statement records the layout id/version used.

### `carrier_coverage_aliases`

Carrier-scoped normalized source coverage label → `line_of_business_id`. Unique per (`carrier_id`, `source_value`). This is **partial** teach-once behavior, not complete layout learning.

### `schema_migrations`

Filename + applied_at. Written only by `npm run db:migrate` / `db:setup`.

## Concept coverage

| Concept | Support |
| --- | --- |
| Group, Carrier, LOB, Agent, Account Manager | Persisted reference entities |
| Agent-to-account | Current primary agent field; not effective-dated assignment history |
| Compensation | 100% allocations + payout snapshots |
| Gross / Agency Net | Cents; see [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| Missing commission | Not modeled |

## Alignment notes

- Duplicate group or agent names can fragment matching and reports.
- Primary assignments are current-state only. History stays on the commission and payout rows.
- In-memory `CommissionRow` helpers are not the persisted source of truth.
