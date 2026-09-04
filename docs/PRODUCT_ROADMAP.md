# Product Roadmap

Authoritative owner: **Alex**, priorities set by **Mo**.

This file lists **future** Commission App 1.0 outcomes only. It does not describe the live release. For what is deployed, use [`RELEASE_STATUS.md`](RELEASE_STATUS.md).

Implemented report/export foundation, compensation allocations, and statement intake already exist. Do not treat those as missing.

## Priority 1 — Statement intake

Finish teach-once / reuse so known carrier structures and coverage labels are reused automatically. Manual mapping and PDF layout remain fallback, not the normal path.

Still incomplete relative to the desired experience:

- Broader reuse of known statement structures beyond current layouts and carrier-scoped coverage aliases
- OCR for scanned or image-only PDFs
- Legacy `.xls` parse, if Mo keeps it on the roadmap

## Priority 2 — Reports

### Agency Report (fuller 1.0)

Build on the existing Agency report. Still planned:

- Prior-month comparison
- Expected / projection
- Missing statements or commissions context
- Top clients / groups
- Useful explanation of meaningful changes

### Agent / Account Manager compensation statement

Sprint 1 implements the recipient commission statement (person + paid month, posted payouts, PDF). Still planned later: email delivery and secure sharing links.

## Priority 3 — Compensation

UX refinements so a new Group + LOB without a complete plan produces a **soft setup reminder**. Do not document today’s settlement silence as an inferred agreement. Settlement rules stay in [`BUSINESS_RULES.md`](BUSINESS_RULES.md).

## Priority 4 — Missing commissions

Carrier statement timing expectations, then Group + Carrier + LOB expectations. Missing items are investigation signals, not automatic coverage termination.

## Priority 5 — Group / People management UX

After core financial workflows:

- Groups: dedicated add, search, carrier/LOB/primary-agent/account-manager/assignment-status filters, group detail
- People: browsing and filtering without dumping the entire book into one table row; clearer Agent vs Account Manager

## Later / only if approved

- Broader auth and roles beyond the demo allow-list
- Export contract for a separate budgeting application

## Not a roadmap

Feature work is **not** authorized by this file. [`CURRENT_SPRINT.md`](CURRENT_SPRINT.md) is the only authorized-work list.
