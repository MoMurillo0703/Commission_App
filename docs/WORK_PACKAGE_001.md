# Work Package 001 — Commission statement intake foundation

## Objective

Create a usable foundation for importing carrier statements and reporting commissions without silently guessing at group, product, or agent assignments.

## Acceptance criteria

- Users can select an `.xlsx`, `.xls`, or `.pdf` statement.
- Excel workbooks are inspected and return sheet names, row counts, and a header preview.
- PDF files are accepted into the intake pipeline and clearly marked as requiring a carrier extraction profile.
- The dashboard distinguishes total commissions, premium, groups, and exceptions.
- Agency and agent reporting views are represented in the navigation and data model.
- Core commission rows preserve carrier, statement period, group, product/line, premium, commission, and agent assignment.
- Unknown mappings remain explicit exceptions; they are never silently assigned.

## Evidence

- Automated tests for totals and exception detection.
- Typecheck, lint, tests, and production build pass.

## Deferred

- Authentication and agency tenancy.
- Database persistence and immutable posted-statement snapshots.
- Carrier-specific PDF extraction profiles.
- Split commissions, overrides, chargebacks, and agent payout rules.
- Report export to Excel/PDF.
