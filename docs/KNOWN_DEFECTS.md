# Known Defects

Authoritative owner: **Tom** (verification). **Alex** records status. **Cleo** implements a fix only when assigned.

Do not treat unverified historical notes as current defects.

## KD-001 — Posted statement contradictory review message

**Status:** Fixed in Sprint 1. A fully posted statement (`postedCount > 0`, no remaining ready or blocked rows) reads as posted. Continue-import copy is not shown.

**Acceptance when verified:** A fully posted statement reads as posted, not as blocked import.

## Other verified current items

None additional from the 1.0 organization audits as **confirmed open product defects**.

Documented **gaps** (not defects): missing-commission feature, fuller Agency Report, OCR, legacy XLS parse, incomplete teach-once automation. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

Documented **limitations** (accepted for now): scanned PDFs and `.xls` retained but not parsed; agent and account manager are separate identities; 20 MB / 200-page extract limits.
