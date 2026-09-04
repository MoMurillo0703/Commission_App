# Known Defects

Authoritative owner: **Tom** (verification). **Alex** records status. **Cleo** implements a fix only when assigned.

Do not treat unverified historical notes as current defects.

## KD-001 — Posted statement contradictory review message

**Status:** Open. Record only. Do not fix in the documentation sprint.

**Observed:** After a statement has posted, Statement Review can still show “Statement needs review” and “Continue Import is unavailable until the statement is ready.” while also showing “already posted” and POSTED rows (example: 30 already posted).

**Why it is a defect:** The screen describes an in-progress import and a finished post at the same time.

**Likely implementation note (not a fix):** `statementReadiness.canContinue` is false when `readyCount === 0` even if `postedCount > 0`; the continue-import copy then appears.

**Acceptance when fixed:** A fully posted statement reads as posted, not as blocked import.

## Other verified current items

None additional from the 1.0 organization audits as **confirmed open product defects**.

Documented **gaps** (not defects): missing-commission feature, fuller Agency Report, formal producer statement, OCR, legacy XLS parse, incomplete teach-once automation. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

Documented **limitations** (accepted for now): scanned PDFs and `.xls` retained but not parsed; agent and account manager are separate identities; 20 MB / 200-page extract limits; printable reports are HTML for browser print, not a binary PDF writer.
