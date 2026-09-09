# Current Sprint

Authoritative owner: **Alex**.

## Phase

Commission App 1.0 Sprint 1 — **DEPLOYED — AWAITING PRODUCT QA / ACCEPTANCE**. Production is `b8e67c621ef4e0af83e2d9e3776886cecf045a92` with migrations **0001–0011** applied (deployed 2026-09-09). Mo is configured as Agency owner (`agents.id = 2`) effective **2026-09 → Present**. Product QA/acceptance is pending Tom’s production verification and Mo’s live check of Change Paid Month and reports. This is not Done. Do not mark Product Accepted or Done until those workflows complete. Do not move a live statement Paid Month, execute H&R/Anthem/linkage repairs, or correct the 12 Historical Agency Fallback or 49 Legacy No-Payout September commissions as a deploy test.

## Authorized work

End-to-end payable commission workflow:

1. Upload and process at least three carrier statements for a paid month.
2. Resolve unmatched Groups without re-reviewing known data.
3. Assign Account Manager and Primary Agent to a Group when needed (assignment ≠ compensation).
4. Confirm the applicable Group + LOB compensation allocation.
5. Post commissions and preserve the original statement.
6. Generate a recipient commission statement for an Agent or Account Manager + paid month from posted payouts.
7. Download that statement as a PDF.
8. Fix KD-001 if the statement-review path is touched.
9. Compensation allocation and Team save must clear Saving… on success or failure (QA-001).
10. Person-first Compensation / Splits view from People, editing the complete Group + LOB allocation (UX-002).
11. Compensation work queue Save & Next must advance without stale success/draft state (QA-001).
12. CaliforniaChoice continuation rows must stay on the current Group; LOB names are not Groups (QA-003).
13. Compensation home and Missing Compensation are Group-first; opening a Group shows all coverage lines together (UX-003).
14. Correct CaliforniaChoice carrier Group identity, row Paid Month semantics, and ADJ CD retention (Ben review blockers).
15. CaliforniaChoice Product must be the LOB candidate; `$` and carrier Paid Month tokens must not block import (QA-005).
16. Searchable / suggested Group matching with teach-once carrier identity; exception assignment Save All; atomic multi-LOB compensation; exact-term timeout recovery.

## Not authorized

Missing commissions, Book of Business, budgeting, CRM, email delivery, secure report links, payment execution/reconciliation, broad dashboard/Groups/People redesign, Medicare/Individual reporting redesign.

## See

- Rules: [`BUSINESS_RULES.md`](BUSINESS_RULES.md)
- Schema: [`DATA_MODEL.md`](DATA_MODEL.md)
- Defects: [`KNOWN_DEFECTS.md`](KNOWN_DEFECTS.md)
- Live release: [`RELEASE_STATUS.md`](RELEASE_STATUS.md)
