# Release Status

Authoritative owner: **Alex**. Update this file when a release is deployed or accepted. Do not copy the roadmap here.

## Production

| Field | Value |
| --- | --- |
| URL | https://commissionapp-iota.vercel.app |
| SHA | `eaaa7eddf74bbd2c36b2d890d0853dfbd784e0b9` |
| Deployed | 2026-09-11 |
| Migrations | **0001–0011** (no new migration for this application deploy) |
| Agency owner | Mo / `agents.id = 2`, effective **2026-09 → Present** |
| Release state | **DEPLOYED — AWAITING LIVE PRODUCT QA** |
| Product acceptance | Pending Mo/Tom live QA of statement post truthfulness and the Groups + People management workspace. Do not post Statement 7 or rewrite production financial records as a deploy test. |

This is **not** completion of Commission App 1.0. Sprint 1 is not Done.

## What this release includes (verified capabilities)

- CSV and XLSX statement intake
- Readable text-PDF intake, including Choice Builder inference and CaliforniaChoice Product/LOB interpretation (`Cal Choice` filename, no `$` / Paid Month LOB review, session Ignore for unknown Products)
- Unmatched group review with searchable / suggested matching; create, match, or ignore; confirmed carrier Group identity learning; fingerprint and source-row duplicate protection
- Private original-file storage
- Groups, Carriers, LOBs, Agents, Account Managers
- Groups directory + Group Detail (`/groups/[groupId]`): search, AND filters, alphabet navigation, assignment by stable IDs, compensation status, received commissions
- People directory + Person Detail (`/people/agent/[id]`, `/people/account-manager/[id]`): typed identities are not merged by name; assignment is not compensation; Reports deep links including separate Mo / Agency
- Statement Post success is tied to persisted commission rows; review/mapped/zero-row responses cannot show financial success; unresolved Group/LOB blocks posting
- Exception-oriented Group Account Manager / Primary Agent assignment with Save All (assignment ≠ compensation; missing assignment does not block posting)
- Compensation allocations (Agency / Person / Team), effective dating, payout snapshots, setup queue
- Compensation queue evaluates the current as-of month first; historical posted-month coverage cannot hide a current gap; multiple or incomplete current coverings are Review Required
- Missing Compensation is Group-first: one queue item per Group, all coverage lines visible together, default selection of unconfigured LOBs only
- One entered split applies to selected LOBs through the existing atomic bulk allocation write; configured LOBs are not silently overwritten; Agency 100% remains available without inventing a Person
- Group-level compensation apply across selected LOBs through one atomic server transaction; LOB overrides remain Group + LOB allocations
- Exact-term timeout/overlap recovery; no automatic mutation retry; queue advances only after a confirmed matching save
- Person-first Compensation / Splits view from People, editing the complete Group + LOB allocation
- Individual Commission Report: choose a recipient and paid month; rows and TOTAL PAYABLE come from posted `commission_payouts`; PDF uses the same document totals
- Report compensation warnings can open Compensation on the exact Groups that need setup
- Authorized historical compensation correction for proven Agency fallbacks and legacy no-payout snapshots, bound to the preview token, with append-only `0008` audit batches/items
- Durable Agency compensation owner (`0009`) and Mo / Agency monthly reconciliation with strict Historical Agency Fallback vs LEGACY — NO PAYOUT SNAPSHOT classification; owner coverage is required for payable-ready
- Posted-statement Change Paid Month is a receipt-month metadata correction (preview → confirm → immutable audit). Destination allocation and Team membership are not required. Posted financial snapshots are preserved. Source coverage / Group / LOB / period labels (`0010`/`0011`); Agency and Individual reports plus PDF/print show coverage month vs source period
- Recipient commission statement + binary PDF from posted `commission_payouts`
- Agency / Individual / Team reporting foundation with CSV, XLSX, printable HTML, and PDF export
- Auth allow-list
- Reliability: global `postgres.js` client, pooler `prepare: false`, bounded lifetimes, DB liveness + one recycle, 45s client deadline, no automatic mutation retry; allocation and Team save clear Saving… on success or failure

Carrier-specific learning includes layouts, `0006` coverage aliases (label → LOB), and `0007` carrier Group identities (carrier + external Group Number → Group). The full teach-once experience is not finished.

## Production data caution

Statement 4 (`Choice Builder - 08 2026.PDF`): 30 preview rows, 11 unmatched groups, source file and mapping retained, **0** posted commissions. Do not delete, recreate, or post it for testing.

Statement 5 (`Cal Choice - 08 2026.pdf`) is Mo’s live CaliforniaChoice Product Acceptance import. Do not create `$` or month LOBs, write parser-garbage aliases, or post it merely to test the deploy.

Posted Anthem commissions from an earlier statement remain historical truth.

Statement 7 (`Beam 09 2026 Commission Report.pdf`): status **mapped**, Paid Month **2026-09**, 45 preview rows, preview gross **$1,329.63**, **0** posted rows, **0** linked commissions. Do not post it to test this deploy.

## 1.0 not claimed complete

Missing commissions, fuller Agency Report, OCR, and payment tracking remain planned. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).
