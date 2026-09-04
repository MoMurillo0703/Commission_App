# Acceptance Tests

Authoritative owner: **Alex** (criteria). **Cleo** owns automated regression. **Tom** owns independent QA and production verification. **Mo** owns product acceptance.

## Verification kinds

| Kind | Who | Environment | Typical gate |
| --- | --- | --- | --- |
| Automated regression | Cleo | CI / local Vitest + PGlite | BUILT |
| Independent QA | Tom | Local or staging against known fixtures | QA PASSED |
| Production verification | Tom | Production at the confirmed SHA | After DEPLOYED, before PRODUCT ACCEPTED |
| Product Owner acceptance | Mo | Production (or agreed demo) | PRODUCT ACCEPTED |

Before production QA: confirm production SHA and that required migrations are applied. See [`RELEASE_STATUS.md`](RELEASE_STATUS.md) and [`DEPLOYMENT.md`](DEPLOYMENT.md).

Deployed ≠ Done.

## Permanent protections

### Duplicate posting

- **Workflow:** Post the same statement or the same source-row key twice.
- **Expected:** No second commission row; fingerprint conflict on re-upload of the same file.
- **Verifier:** Cleo automated (`importPosting`, `statements` fingerprint tests); Tom on a non-production or already-posted statement without creating new posted rows in production unless Mo approves.
- **Environment:** Test DB; production only as read-only confirmation of existing uniqueness.
- **Gate:** BUILT + QA PASSED.

### Historical payout immutability

- **Workflow:** Change an allocation or team after commissions are posted.
- **Expected:** Existing `commission_payouts` amounts and recipients stay; new posts use new terms.
- **Verifier:** Cleo automated; Tom QA on a copy or by inspecting existing production payouts without editing them.
- **Gate:** BUILT + QA PASSED.

### Effective-dated compensation

- **Workflow:** Two non-overlapping allocations for the same Group + LOB; post in each paid month.
- **Expected:** Each paid month uses the plan in force that month.
- **Verifier:** Cleo automated; Tom QA.
- **Gate:** BUILT + QA PASSED.

### Agency Net reconciliation

- **Workflow:** Post a row with a complete 10,000 bps allocation that includes Agency.
- **Expected:** Agency payout matches Agency bps × gross; header `agency_net_cents = gross - non-Agency`; no double count.
- **Verifier:** Cleo automated financial tests; Ben if the formula changes.
- **Gate:** BUILT.

### Choice Builder PDF parsing

- **Workflow:** Choice Builder–shaped extracted pages (in-repo structure fixture and, when Tom uses it, the real production file).
- **Expected:** In-repo fixture still interprets to **26** confirmation rows with continuation/wrap/`($0.89)` alignment. Production file **Choice Builder - 08 2026.PDF** has been accepted at **30** rows and **11** unmatched groups. Do not “improve” the parser without evidence.
- **Verifier:** Cleo `choiceBuilderRealStructure` tests; Tom production reopen of statement 4 (read-only).
- **Gate:** BUILT; production verification read-only.

### Negative commission / chargeback preservation

- **Workflow:** A statement amount such as `($0.89)`.
- **Expected:** Stored as a negative or parenthetical commission, not dropped, not treated as a new header.
- **Verifier:** Cleo Choice Builder / money-token tests; Tom if a live statement contains chargebacks.
- **Gate:** BUILT.

### Cross-page PDF continuation

- **Workflow:** Company name wraps or continues after a page break on a Choice Builder–shaped statement.
- **Expected:** Continuation rows stay aligned to the policy/company; month tokens are not treated as group names.
- **Verifier:** Cleo structure tests; Tom on the real file if re-checking extract (do not recreate statement 4).
- **Gate:** BUILT.

### Busy-state clearing

- **Workflow:** Upload or preview when the request fails or never settles.
- **Expected:** “Reading and saving…” / “Working…” clears; user sees a timeout or failure message; no automatic retry.
- **Verifier:** Cleo `apiClient` hung-fetch test; Tom if a live timeout is reproduced.
- **Gate:** BUILT.

### Request timeout / no automatic mutation retry

- **Workflow:** Hung inspect, preview, confirm, or post.
- **Expected:** Client aborts by 45s; no second POST.
- **Verifier:** Cleo automated; Tom observes network tab if exercising UI.
- **Gate:** BUILT.

### Migrations not on requests

- **Workflow:** Application `getDb()` / liveness recycle.
- **Expected:** No `applyMigrations` on the request path.
- **Verifier:** Cleo `src/db/index.test.ts` and liveness tests; Ben on architecture change.
- **Gate:** BUILT.

## Release smoke (non-destructive)

- **Workflow:** Open production unsigned.
- **Expected:** Redirect to sign-in; APIs return 401 JSON; no hang.
- **Verifier:** Tom (or deploy smoke by Cleo when assigned).
- **Environment:** Production.
- **Gate:** After DEPLOYED.

Do not post commissions or alter statement 4 to complete smoke tests.
