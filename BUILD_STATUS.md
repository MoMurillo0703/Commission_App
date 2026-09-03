# Build Status

Status reflects code verified on September 3, 2026 after the Demo Review allocation/reporting round.

## COMPLETE

- Next.js application scaffold renders and completes a production build.
- Responsive overview-page presentation is implemented.
- `.xlsx` and CSV inspection reads statement rows and detects headers after carrier preambles.
- Unsupported upload types receive an HTTP 415 response.
- PDF and legacy XLS uploads are retained and resumable. Text-based PDFs can be extracted into the same review pipeline. Scanned/image PDFs and legacy XLS remain unparsed with a clear next step.
- PDF inspect failures never return the CSV/XLSX error copy. Classification uses extension, MIME, and `%PDF` magic bytes. Unexpected PDF errors say extraction failed and can still persist the original.
- Persistence is Postgres through Drizzle. Hosted demo uses Supabase Postgres. Tests use in-memory PGlite. Historical SQLite migrations remain in `migrations/sqlite/` and are not applied.
- Money is stored as integer cents. Compensation uses integer basis points. Canonical Agency Net is the explicit Agency allocation; the commission header still stores `agency_net_cents = gross - non-Agency compensation`.
- Historical commission updates preserve stored compensation when terms are not supplied. New commissions use an explicit rate, else the dated group/LOB allocation. Legacy partial agreements preserve only their known Person compensation under the prior single-rate behavior and do not fabricate an Agency payout. No agreement or allocation means 100% Agency.
- Posted commissions write `commission_payouts` snapshots. Later team, percentage, or assignment changes do not rewrite those rows.
- Groups support bulk Account Manager and Primary Agent assignment on the current filtered list. Bulk assignment does not create or change compensation.
- Group Edit opens an explicit “Editing: {name}” panel with Save Changes and Cancel. It does not silently reuse the add form.
- Compensation is managed as complete 100% allocations (Agency, up to 5 people, reusable teams) on the Compensation page. Statements display calculated compensation and do not configure terms. A work queue lists Group + LOB combinations that are missing, incomplete, or inactive.
- Reports include Agency, Individual, and Team views from posted data, with paid-month / range / YTD and Group, Carrier, LOB, recipient, team, Account Manager, and Primary Agent filters. The default Agency report loads all posted months. CSV, XLSX, and printable/PDF HTML export use the same canonical dataset.
- Original uploaded statement files are stored and can be downloaded. Local development can use the filesystem. Vercel requires private Supabase Storage and does not fall back to ephemeral disk.
- Hosted demo authentication uses Supabase email/password. Unsigned visitors cannot read commission pages or APIs. On Vercel, Auth env vars and `DEMO_ALLOWED_EMAILS` are required.
- Navigation has focused Overview, Statements, Groups, Carriers, People, Compensation, and Reports pages.
- Demo deployment docs and env templates exist in `DEPLOYMENT.md` and `.env.example`.

## IN PROGRESS

- Statement intake: CSV/XLSX and text-based PDF mapping, resolve, review, and posting exist; OCR for scanned PDFs and legacy XLS parsing do not.
- Exception handling: unmatched import rows are blocked in preview; unassigned posted records are counted as needing review, but there is no broader correction workflow.
- Hosted demo: this implementation round is not deployed. Additive migration `0005` raises the direct-person activation limit to 5.

## NOT STARTED

- Missing commission expectation and reconciliation
- OCR for scanned/image-only PDF statements
- Carrier-specific compensation split rules
- Role-based authorization beyond the demo allow list
- Budgeting integration
- A unified People identity shared by agent and account-manager roles

## KNOWN ISSUES

- Legacy `.xls` files are retained but cannot be mapped or posted until conversion support exists. Scanned/image PDFs are retained but cannot be read until OCR is approved.
- Agents and account managers remain independent records. A durable “both roles” identity is not modeled; matching display names are intentionally shown as separate role records.
- Uploads are limited to 20 MB, and PDF extraction is limited to 200 pages. Malware scanning and content-signature validation are not implemented.
- ExcelJS 4.4.0 currently brings a moderate-severity transitive `uuid` advisory; `npm audit --omit=dev` exits nonzero.
- `groups.default_compensation_bps` leftover values are not migrated into allocations. Existing local SQLite files are not converted automatically.
- Printable/PDF reports are formal HTML suitable for browser Print / Save as PDF, not a slide deck or binary PDF writer.
- This Product Owner acceptance-review implementation has not been deployed. Do not deploy until ChatGPT and the Product Owner approve.

## NEXT RECOMMENDED BUILD TASKS

1. Review the compensation allocation model and apply production migration `0004` only after Product Owner approval.
2. Add expected-payment reconciliation for missing commissions after the hosted demo is verified.
