# Architecture

Authoritative owner: **Ben**. Runtime procedures that operators run are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Stack

- Next.js App Router (Node 22+) on Vercel
- Postgres (Supabase) through Drizzle + `postgres.js`
- Supabase Auth (email/password) and private Storage for original statements
- Tests: Vitest + PGlite (no live credentials)

Application data is read and written only by authenticated Next.js server routes. The browser does not use the anon key for table access.

## Application layout

- `src/app` — pages and API routes
- `src/data` — persistence and application services
- `src/domain` — pure rules, mapping, reports, money
- `src/components` — client UI
- `src/db` — Drizzle schema, client, explicit migrate helper used by `scripts/db-setup.mjs`
- `src/lib` — HTTP, storage, bounded fetch, errors

Nav: Overview, Statements, Groups, Carriers, People, Compensation, Reports.

## Database client

`getDb()` reuses one global `postgres.js` client per serverless isolate.

Approved production settings (reliability release):

- Supabase **transaction pooler** port `6543`
- `prepare: false`
- `max: 10`
- `connect_timeout: 10` seconds
- `idle_timeout: 20` seconds
- `max_lifetime: 120` seconds
- `statement_timeout: 15000` ms
- Liveness: bounded `SELECT 1` before application SQL
- If liveness fails: dispose with `sql.end`, create one fresh client, ping again
- If the replacement fails: controlled error, no further recycle
- Concurrent `getDb()` callers share one in-flight ensure
- **No** request-path migrations
- **No** automatic retry of a financial mutation after it has started

## Client request bounds

Statement intake and review use a shared `fetchWithDeadline` (AbortController, **45 seconds**). Timeout clears busy state and does not resubmit upload, preview, confirm, or post.

## Statement pipeline

1. `POST /api/imports/inspect` — classify, extract, persist statement + original file
2. Preview / unmatched review — `preview` and confirm group/LOB/agent decisions
3. `POST .../post` — create commissions and payouts; source-row key prevents duplicates

Text PDFs: extract → interpret (including Choice Builder inference when it applies) → review exceptions → confirm → post. Manual mapping and PDF layout are fallback.

Carrier learning today: versioned `carrier_statement_layouts` plus `0006` coverage aliases. This is not the full teach-once product.

## Compensation and reports

Posting resolves the allocation (or legacy settlement) for the paid month and writes `commission_payouts`. Reports read posted commissions and payouts. The recipient commission statement is that same snapshot data, downloadable as a binary PDF. It does not create a separate financial ledger or payment status. See [`BUSINESS_RULES.md`](BUSINESS_RULES.md).

## Auth

`src/proxy.ts` requires a signed-in allow-listed email for pages and APIs on Vercel. Locally, missing Auth env vars leave pages open for development.
