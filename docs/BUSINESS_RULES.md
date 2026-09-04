# Business Rules

Authoritative owner: **Mo**. Technical phrasing maintained by **Alex** with **Ben** review when financial meaning changes.

This is the canonical product/financial rulebook. Schema details live in [`DATA_MODEL.md`](DATA_MODEL.md). Dated decisions live in [`DECISIONS.md`](DECISIONS.md).

## Organization of time and money

- Commission records are organized by **paid month**: the month the agency received the commission.
- **Premium / coverage month** is separate when known. Do not assume they are the same.
- **Paid month** selects which effective-dated compensation plan applies.
- Persist money as **integer cents**. Persist rates and splits as **integer basis points** (10,000 bps = 100%). Do not persist financial values as binary floating point.
- Financial relationships use **stable database IDs**, not mutable display names.

## Assignment versus compensation

- Assigning a primary agent or account manager to a group does **not** create compensation.
- Compensation is a **Group + line of business + effective period** allocation.
- Recipients may be Agency, a Person (agent or account manager), or a Team.
- An **active** allocation must total exactly **10,000 bps**.
- **Agency is explicit** when an allocation exists. Do not infer an Agency remainder to “fill” a partial plan.
- Agency and Team entries do **not** consume the five-direct-Person limit. At most five direct Person entries may appear on an active allocation.
- Team member shares for an active team period must total 10,000 bps.

## Historical integrity

- Changing a current assignment or split must **never** silently alter posted commission records or payouts.
- Active or used allocations are **immutable**. A terms change closes the prior period and inserts a new allocation.
- Posted `commission_records` and `commission_payouts` are historical truth. Later team, percentage, or assignment edits do not rewrite those rows.
- Agency Net must not be double-counted. Canonical Agency Net is the explicit Agency allocation when a complete allocation exists. The commission header still stores `agency_net_cents = gross_commission_cents - agent_compensation_cents`, where agent compensation is all non-Agency distributed amounts.

## Settlement behavior (current)

When a commission is created:

1. Use an explicit rate on the commission if supplied.
2. Else use the effective-dated Group + LOB **allocation** for the paid month.
3. Else, during legacy compatibility only, an applicable **legacy agreement** preserves that agreement’s known Person share and header Agency Net under the prior single-rate behavior. It does **not** fabricate an Agency payout recipient and does **not** infer an Agency remainder for a partial agreement.
4. If there is **no** allocation and **no** applicable agreement, settlement is **100% Agency**. That is a default settlement, not a stored compensation agreement.
5. Deprecated `groups.default_compensation_bps` and `agents.default_compensation_bps` are **not** fallbacks.

Absence of a plan is not an inferred 100% producer agreement. Desired UX may later **nudge** setup of a complete allocation; that reminder is not the same as inventing terms. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

On update, omitting compensation while keeping the same header agent preserves the stored rate and amounts. An explicit compensation change is recalculated and stored.

## Statement intake

- Unmatched groups, coverage labels, or agents require **explicit review**. Do not silently invent relationships.
- Duplicate protection uses the statement **file fingerprint** and, after post, **statement ID + source-row key**.
- Original uploaded files remain identifiable and downloadable.
- Readable text PDFs should be read and interpreted automatically when the app can do so. Manual column mapping and PDF layout help are **fallback**, not the normal path.
- Negative commissions / parenthetical chargebacks on a statement are real amounts. Preserve the sign. They are not dropped and are not automatic policy terminations.
- Statement columns do not define compensation. Compensation comes from the allocation (or the settlement rules above).

## Missing commissions (when built)

Missing items are investigation signals, not a finding that coverage terminated. This capability is not implemented. See [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md).

## Operations

- Runtime application requests **never** apply schema migrations. See [`DEPLOYMENT.md`](DEPLOYMENT.md).
