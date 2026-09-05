# Release Status

Authoritative owner: **Alex**. Update this file when a release is deployed or accepted. Do not copy the roadmap here.

## Production

| Field | Value |
| --- | --- |
| URL | https://commissionapp-iota.vercel.app |
| SHA | `bb5701f316f3405a7322fee571004673169a463a` |
| Migrations | **0001–0006** applied (none required for this release) |
| Release state | **Deployed** |
| Product acceptance | Pending Mo smoke test |

This is **not** completion of Commission App 1.0. Sprint 1 is not Done.

## What this release includes (verified capabilities)

- CSV and XLSX statement intake
- Readable text-PDF intake, including Choice Builder inference
- Unmatched group review; create or match; fingerprint and source-row duplicate protection
- Private original-file storage
- Groups, Carriers, LOBs, Agents, Account Managers
- In-workflow Group Account Manager / Primary Agent assignment (assignment ≠ compensation)
- Compensation allocations (Agency / Person / Team), effective dating, payout snapshots, setup queue
- Person-first Compensation / Splits view from People, editing the complete Group + LOB allocation
- Recipient commission statement + binary PDF from posted `commission_payouts`
- Agency / Individual / Team reporting foundation with CSV, XLSX, printable HTML, and PDF export
- Auth allow-list
- Reliability: global `postgres.js` client, pooler `prepare: false`, bounded lifetimes, DB liveness + one recycle, 45s client deadline, no automatic mutation retry; allocation and Team save clear Saving… on success or failure

Carrier-specific learning is **partial** (layouts + `0006` coverage aliases). The full teach-once experience is not finished.

## Production data caution

Statement 4 (`Choice Builder - 08 2026.PDF`): 30 preview rows, 11 unmatched groups, source file and mapping retained, **0** posted commissions. Do not delete, recreate, or post it for testing.

Posted Anthem commissions from an earlier statement remain historical truth.

## 1.0 not claimed complete

Missing commissions, fuller Agency Report, OCR, payment tracking, and broader Groups/People UX remain planned. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).
