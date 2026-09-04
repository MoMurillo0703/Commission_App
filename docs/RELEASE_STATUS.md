# Release Status

Authoritative owner: **Alex**. Update this file when a release is deployed or accepted. Do not copy the roadmap here.

## Production

| Field | Value |
| --- | --- |
| URL | https://commissionapp-iota.vercel.app |
| SHA | `5139fbd632c3dd11b74288eb248a57d3c29d0297` |
| Migrations | **0001–0006** applied |
| Release state | **Deployed** |
| Reliability stabilization | Product Owner acceptance substantially completed |

This is **not** completion of Commission App 1.0.

## What this release includes (verified capabilities)

- CSV and XLSX statement intake
- Readable text-PDF intake, including Choice Builder inference
- Unmatched group review; create or match; fingerprint and source-row duplicate protection
- Private original-file storage
- Groups, Carriers, LOBs, Agents, Account Managers
- Compensation allocations (Agency / Person / Team), effective dating, payout snapshots, setup queue
- Agency / Individual / Team reporting foundation with CSV, XLSX, and printable HTML export
- Auth allow-list
- Reliability: global `postgres.js` client, pooler `prepare: false`, bounded lifetimes, DB liveness + one recycle, 45s client deadline, no automatic mutation retry

Carrier-specific learning is **partial** (layouts + `0006` coverage aliases). The full teach-once experience is not finished.

## Known remaining UI defect

Posted-statement contradictory review message. See [`KNOWN_DEFECTS.md`](KNOWN_DEFECTS.md).

## Production data caution

Statement 4 (`Choice Builder - 08 2026.PDF`): 30 preview rows, 11 unmatched groups, source file and mapping retained, **0** posted commissions. Do not delete, recreate, or post it for testing.

Posted Anthem commissions from an earlier statement remain historical truth.

## 1.0 not claimed complete

Missing commissions, fuller Agency Report, formal producer statements, OCR, and Groups/People UX remain planned. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).
