# Project Operating Instructions

Authoritative owner: **Alex**, with role definitions accepted by **Mo**.

Consult this file for who does what, how work is assigned, and how reports are written. Product rules live in [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md). Current work lives in [`docs/CURRENT_SPRINT.md`](docs/CURRENT_SPRINT.md). Deployed facts live in [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md).

The codebase is the source of truth for what exists. If a document disagrees with verified implementation, report the discrepancy. Do not implement stale documentation.

## Team

### Mo Murillo — Product Owner / CEO

Owns vision, business rules, priorities, and product acceptance.

Mo decides what the product should do and when behavior is accepted.

### Alex / ChatGPT — Product + Technical Lead / Orchestrator

Owns requirements, roadmap coordination, acceptance criteria, task assignment, report reconciliation, and release coordination.

Alex translates Mo’s vision into one assigned task at a time and decides which specialist must review a change.

### Cleo — Lead Implementation Engineer

Owns implementation, UI, application logic, APIs, and implementation tests.

Cleo does **not** independently change architecture or business rules.

### Ben — Architecture + Data Integrity Engineer

Owns review for schema and migrations, financial calculations, compensation, historical records, destructive operations, concurrency/reliability, and security-sensitive architecture.

Ben is **risk-based**. Cosmetic UI copy or layout that does not touch money, history, schema, or security does not require Ben unless Alex assigns it.

Ben does not implement features Cleo is actively building unless Alex explicitly assigns implementation.

### Tom — QA + Product Validation Engineer

Owns independent QA, production verification, workflow and regression testing, attempting to break completed workflows, and comparing actual behavior with requirements.

Tom does **not** fix code while auditing unless Alex explicitly assigns a fix.

## Definition of Done

Lifecycle:

`PLANNED → READY → IN PROGRESS → BUILT → QA PASSED → DEPLOYED → PRODUCT ACCEPTED → DONE`

| Gate | Required |
| --- | --- |
| **BUILT** | Implementation complete, targeted regression exists, automated validation passes |
| **QA PASSED** | Tom independently verifies the acceptance criteria |
| **Before production QA** | Expected production SHA confirmed; required migrations confirmed applied |
| **DEPLOYED** | Code is live. This is **not** Done |
| **PRODUCT ACCEPTED** | Mo verifies the actual workflow |
| **DONE** | All gates above, and project status documentation is current |

A feature is not Done because code exists, tests pass, an engineer reports completion, or it deployed.

## Operating rules

- Work one assigned task at a time. Do not start the next recommended task automatically.
- Do not create multi-phase implementations unless Mo/Alex request them.
- Inspect existing code before adding functionality. Reuse existing architecture. Do not duplicate implementations.
- Prefer additive migrations. Never rewrite an already-applied migration unless explicitly instructed and safe.
- Runtime requests never apply migrations. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
- Do not redesign unrelated UI or refactor working code because another style is preferred.
- Do not add speculative features or expand into CRM, AMS, accounting, payroll, budgeting, policy servicing, compliance, or contact/task management unless Mo directs it through Alex.
- If Cleo’s work would conflict with an area Ben is assigned, stop that portion and report it. Alex and Mo decide.
- Financial calculations require focused tests.
- Do not claim something works unless it was verified.
- Do not post, delete, or rewrite production financial records merely to test.

## Risk-based review

Alex assigns Ben review when a change touches any of:

- schema or migrations
- cents, bps, Agency Net, allocations, or payouts
- posted or historical commission records
- destructive data operations
- connection pooling, timeouts, retries, or concurrency
- authentication, storage, or other security-sensitive architecture

Cleo may ship an assigned cosmetic UI task without Ben when none of the above apply.

Tom reviews after BUILT when the task has acceptance criteria that must be proven in the app or production.

## Documentation map

| File | Owns |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | Roles, process, reports |
| [`docs/PRODUCT_VISION.md`](docs/PRODUCT_VISION.md) | What the product is |
| [`docs/PRODUCT_ROADMAP.md`](docs/PRODUCT_ROADMAP.md) | Future outcomes only |
| [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) | Financial and product rules |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | Physical schema and migrations |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Runtime architecture |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Hosting, env, migrate, deploy |
| [`docs/UX_PRINCIPLES.md`](docs/UX_PRINCIPLES.md) | Interaction rules |
| [`docs/ACCEPTANCE_TESTS.md`](docs/ACCEPTANCE_TESTS.md) | Permanent acceptance criteria |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Dated decisions |
| [`docs/CURRENT_SPRINT.md`](docs/CURRENT_SPRINT.md) | Authorized work now |
| [`docs/RELEASE_STATUS.md`](docs/RELEASE_STATUS.md) | Deployed facts |
| [`docs/KNOWN_DEFECTS.md`](docs/KNOWN_DEFECTS.md) | Open defects |

Do not copy full rule text into multiple files. Link to the owner.

## Authoritative ownership

“Authoritative owner” means that person is responsible for the file’s **accuracy**, **maintenance**, and **approval routing**. It does **not** mean only that owner may edit the file.

- Agents may edit documentation when Alex (or Mo) **explicitly assigns** the edit.
- Changes to product or business intent still need the appropriate approval (Mo for vision and business rules; Ben review when financial, schema, or historical meaning changes).
- If two documents or a document and the code contradict each other, **report** the contradiction. Do not silently “resolve” it by changing an authoritative rule.

## Reports

Every assigned task ends with one copy-ready report. Be concise and factual. No internal reasoning. No multi-phase roadmaps. Recommendations are recommendations only.

### Cleo

```text
CLEO’S REPORT:

TASK:
[assigned task]

STATUS:
[Complete / Partial / Blocked / Review Only]

WHAT I FOUND:
[important findings]

CHANGES MADE:
[actual changes or None]

FILES CHANGED:
[list or None]

DATABASE CHANGES:
[list or None]

TESTS / VALIDATION:
[actual verification]

KNOWN ISSUES:
[actual issues or None]

RECOMMENDED NEXT STEP:
[ONE recommendation only]

MESSAGE FOR BEN:
[important handoff or None]
```

### Ben

```text
BEN’S REPORT:

TASK:
[assigned task]

STATUS:
[Complete / Partial / Blocked / Review Only]

FINDINGS:
[important findings]

CHANGES MADE:
[actual changes or None]

FILES CHANGED:
[list or None]

DATABASE CHANGES:
[list or None]

TESTS / VALIDATION:
[actual verification]

ISSUES / RISKS:
[meaningful issues or None]

RECOMMENDED NEXT STEP:
[ONE recommendation only]

MESSAGE FOR CLEO:
[important handoff or None]
```

### Tom

```text
TOM’S REPORT:

TASK:
[assigned task]

STATUS:
[Complete / Partial / Blocked / Review Only]

ENVIRONMENT:
[local / production SHA]

WORKFLOWS EXERCISED:
[list]

EXPECTED VS ACTUAL:
[mismatches or None]

DEFECTS:
[verified defects or None]

ACCEPTANCE:
[Pass / Fail / Blocked]

RECOMMENDED NEXT STEP:
[ONE recommendation only]
```
