# Build Status

Status reflects code verified on August 31, 2026.

## COMPLETE

- Next.js application scaffold renders and completes a production build.
- Responsive overview-page presentation is implemented.
- `.xlsx` inspection reads workbook sheets, row counts, and first-row header text.
- Unsupported upload types receive an HTTP 415 response.
- PDF uploads are recognized and returned with a `needs_profile` status; no PDF content is extracted.
- In-memory agency and per-agent summary functions calculate commission, available premium, distinct groups, and mapping exceptions.
- Two unit tests cover the current summary examples.
- Persistence is Postgres through Drizzle. Hosted demo uses Supabase Postgres. Tests use in-memory PGlite. Historical SQLite migrations remain in `migrations/sqlite/` and are not applied.
- Money is stored as integer cents. Compensation uses integer basis points. Agency net is gross commission minus agent compensation.
- Historical commission updates preserve stored compensation when terms are not supplied. New commissions use an explicit rate, else the dated group/agent/LOB agreement, else 0%.
- Commission records relate to groups, carriers, lines of business, and optional agents by database IDs.
- Postgres migrations apply automatically when the database is opened, inside a transaction with an advisory lock.
- Overview stats, agent production, and recent statement totals are loaded from persisted records, including honest zero/empty states.
- Create, view, and edit screens exist for groups, carriers, lines of business, agents, and commission records.
- Focused tests cover currency parsing, agency net calculation, foreign-key relationships, and basic persistence.
- Paid-month Excel statements can be uploaded, inspected, column-mapped, previewed, and posted into commission records. New uploads require a statement-level Carrier: select an existing one or create one in the intake form. Normalized names reuse the existing carrier. Legacy statements without a carrier remain readable.
- When a statement has a carrier, imported rows can use that carrier without mapping a Carrier column. A mapped row-level carrier still wins when present. Unmatched row-level carrier names are blocked and not auto-created.
- Import posting uses the statement paid month, keeps premium/coverage month on the posted row when mapped, leaves unmatched groups uncreated, and resolves a missing split from the dated group compensation agreement. It does not use the agent-level default.
- Duplicate posting of the same saved statement row is prevented by import statement ID plus source row key.
- Groups can store one account manager and one primary agent. Assignment does not pay an agent.
- Agent compensation is stored as effective-dated group/agent/line-of-business agreements (`group_compensation_agreements`). A new rate closes the prior period and keeps the old row. Existing commission records stay historical snapshots.
- `groups.default_compensation_bps` remains in the schema for compatibility and is no longer used to resolve future commission or import splits.
- Groups, Agents, and Account Manager screens can show the groups tied to a person and the current plus historical compensation arrangements for a group.
- Future manual commissions and Excel posting resolve the applicable agreement for group + agent + LOB + paid month. No agreement means 0% agent compensation.
- Original uploaded statement files are stored and can be downloaded. Local development can use the filesystem. Vercel requires private Supabase Storage and does not fall back to ephemeral disk.
- Hosted demo authentication uses Supabase email/password. Unsigned visitors cannot read commission pages or APIs. On Vercel, Auth env vars and `DEMO_ALLOWED_EMAILS` are required.
- Demo deployment docs and env templates exist in `DEPLOYMENT.md` and `.env.example`.
- ESLint, typecheck, unit tests, and production build pass.

## IN PROGRESS

- Statement intake: Excel mapping, review, and posting exist; PDF extraction and CSV import do not.
- Reporting presentation: the overview now uses persisted totals, but dedicated report pages and filters are not built.
- Exception handling: unmatched import rows are blocked in preview; unassigned posted records are counted as needing review, but there is no broader correction workflow.
- Hosted demo: code is deployment-ready. Live Supabase/Vercel credentials were not available in this environment, so the Product Owner still needs to create the project, set env vars, and deploy.

## NOT STARTED

- Multi-agent allocation tables or a compensation-plan engine
- Carrier-specific compensation split rules
- Missing commission expectation and reconciliation
- PDF extraction
- CSV import
- Real monthly, group, carrier, line-of-business, and agent report pages
- YTD and month-over-month reporting
- Data export
- Role-based authorization beyond the demo allow list
- Budgeting integration

## KNOWN ISSUES

- Navigation Reports remains a visual placeholder.
- The file picker accepts `.xls`, but the backend always uses ExcelJS's `.xlsx` loader. Legacy `.xls` files are therefore advertised but not actually supported.
- CSV is not accepted.
- PDF files are classified but neither parsed nor retained.
- Uploads have no explicit size limit, malware control, or content-signature validation.
- Import errors are collapsed into one generic workbook error and provide no row-level diagnostics.
- The in-memory `CommissionRow` type still uses display strings and JavaScript `number`; it is not the persisted model.
- `summarizeByAgent` still groups in-memory rows by display name.
- ExcelJS 4.4.0 currently brings a moderate-severity transitive `uuid` advisory; `npm audit --omit=dev` exits nonzero.
- Import posting is covered by workbook-fixture unit tests; there are still no HTTP route tests.
- Commission records currently support one optional agent and one split percent. They do not model multi-agent splits, chargebacks as first-class documents, or expected-versus-received missing commissions.
- `groups.default_compensation_bps` leftover values are not migrated into agreements. Existing local SQLite files are not converted automatically; Postgres is a new empty database unless the Product Owner loads data.
- `PROJECT.md` and `DATA_MODEL.md` still describe SQLite and an earlier persistence boundary. The codebase and `DEPLOYMENT.md` are the source of truth for hosted Postgres.

## NEXT RECOMMENDED BUILD TASKS

1. Product Owner: create the Supabase project, set Vercel env vars, and deploy using `DEPLOYMENT.md`.
2. Add expected-payment reconciliation for missing commissions after the hosted demo is verified.
3. Build the required report filters, YTD/month-over-month comparisons, and clean export after the underlying calculations are verified.
