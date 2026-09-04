# Product Vision

Authoritative owner: **Mo**. Maintained by **Alex**.

## What this is

Commission App is a simple internal tool for Murillo Insurance to import carrier commission statements, understand what the agency was paid, track compensation owed, identify missing commissions, and report agency and producer income accurately.

It serves Mo and the agency’s operational need to close each paid month without rebuilding the book in a spreadsheet.

## Daily experience (1.0)

1. A carrier payment arrives.
2. Mo downloads the statement.
3. Mo uploads it.
4. The app recognizes known groups, coverage labels, and layouts where it can.
5. Mo reviews only exceptions and new groups.
6. Commission history updates.
7. Compensation updates from the Group + line of business plan for that paid month.
8. Missing commissions become visible (planned; not built yet).
9. Reports update.
10. Mo leaves the app.

The app should learn carrier-specific mappings so known information is not re-reviewed every month. That learning is only **partially** implemented today. See [`RELEASE_STATUS.md`](RELEASE_STATUS.md) and [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

## 1.0 purpose

Import statements with minimal manual work, settle compensation from explicit Group + LOB allocations, and report income without silently rewriting history.

## Out of scope

Unless Mo directs otherwise through Alex, do not expand into:

- CRM
- AMS
- General accounting or general ledger
- Payroll or disbursements
- Budgeting or forecasting (a later export to a separate budgeting app may be allowed)
- Policy servicing, enrollment, or claims
- Compliance management
- Contact management
- General task management
- Multitenant SaaS infrastructure

## Related

- Rules: [`BUSINESS_RULES.md`](BUSINESS_RULES.md)
- Future outcomes: [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md)
- What is live: [`RELEASE_STATUS.md`](RELEASE_STATUS.md)
