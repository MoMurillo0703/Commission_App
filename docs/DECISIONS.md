# Decisions

Authoritative owner: **Alex**. Rule text lives in [`BUSINESS_RULES.md`](BUSINESS_RULES.md) unless noted.

Record only intentional decisions and why. Do not restate the full rulebook.

| Date | Decision | Why | See |
| --- | --- | --- | --- |
| 2026 | Paid month drives compensation | Agency cash received is the organizing event; coverage month is extra when known | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026-09 | Posted statement Paid Month may be corrected without delete/re-upload | Mo needs to move a posted statement to the month the agency actually received it; payouts must not be silently recalculated | [`BUSINESS_RULES.md`](BUSINESS_RULES.md), [`DATA_MODEL.md`](DATA_MODEL.md) (`0011`) |
| 2026-09 | Change Paid Month is a receipt-month metadata correction, not compensation recalculation | Destination allocation and Team membership do not gate or rewrite stored snapshots; September→August is allowed with no August plan | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026-09 | H&R canonical Group is 29 | Group 8 is re-pointed into 29 without deleting Group 8 or copying its current allocations | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026-09 | Anthem group-business LOB codes are bounded | MED/MEDHMO → Group Medical; DENPPO → Group Dental; VIS → Group Vision. Carrier-scoped, deterministic, raw-source preserving | [`DATA_MODEL.md`](DATA_MODEL.md) |
| 2026-09 | Raw Group, LOB, and source-period labels are independent | Do not overload `source_coverage_label` for imported LOB | [`DATA_MODEL.md`](DATA_MODEL.md) (`0011`) |
| 2026 | Exact integer cents and basis points | Avoid float drift on money and splits | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026 | Payout snapshots at post | Later allocation or team edits must not rewrite history | [`BUSINESS_RULES.md`](BUSINESS_RULES.md), [`DATA_MODEL.md`](DATA_MODEL.md) |
| 2026 | Agency is an explicit recipient when an allocation exists | Agency Net must be auditable, not a leftover | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026 | No Agency remainder inference for legacy partial agreements | Partial legacy copies stay incomplete until a human finishes 10,000 bps | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026 | At most five direct People on an active allocation | Keep plans operable; Agency and Team do not count | [`DATA_MODEL.md`](DATA_MODEL.md) (`0005`) |
| 2026 | Deprecated group/agent default bps are not fallbacks | Prevent silent historical-looking rates | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
| 2026 | Text-PDF inference preferred over manual mapping when valid | Daily path is read → exceptions → post | [`UX_PRINCIPLES.md`](UX_PRINCIPLES.md) |
| 2026-09 | Choice Builder: treat `($0.89)` as money, not a new header; keep continuation names aligned | First-pass clustering split on parentheticals and mis-assigned wrap lines | Parser tests; do not “improve” without evidence |
| 2026 | Manual layout/mapping is fallback | Advanced recovery only | [`UX_PRINCIPLES.md`](UX_PRINCIPLES.md) |
| 2026-09 | Request-time migrations removed | Cold-start migrate + pooler hangs blocked intake | [`ARCHITECTURE.md`](ARCHITECTURE.md), [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| 2026-09 | Stale DB client recycle (one attempt) | Serverless isolates can resume a dead pooler socket | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 2026-09 | 45s client deadline; no automatic mutation retry | Bound hung fetches below Vercel 300s; never replay a write | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| 2026-09 | Carrier-scoped coverage aliases (`0006`) | Reuse a confirmed coverage label for that carrier only | [`DATA_MODEL.md`](DATA_MODEL.md) |
| 2026-09 | Carrier-scoped Group identities (`0007`) | CaliforniaChoice Group Number belongs to the carrier, not `groups.group_number` | [`DATA_MODEL.md`](DATA_MODEL.md) |
| 2026-09 | Docs live under `/docs` with one owner per topic | Audits found conflicting root files (`BUILD_STATUS`, `PROJECT`, work package 001) | [`AGENTS.md`](../AGENTS.md) |
| 2026-09 | Recipient statement PDF from posted payouts; no generated-report ledger | Sprint 1 needs a downloadable payable statement without a second financial dataset | [`CURRENT_SPRINT.md`](CURRENT_SPRINT.md) |
| 2026-09 | Individual/Team reports project current unpaid earnings from Paid Month | Stored payout snapshots are audit artifacts and must not hide a commission or freeze current earnings; no Agent Payment ledger yet | [`BUSINESS_RULES.md`](BUSINESS_RULES.md) |
