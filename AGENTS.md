# Project Operating Instructions

## Project Team

The user is the **Product Owner**.

ChatGPT is the **Project Quarterback**. ChatGPT evaluates agent reports with the Product Owner and determines the next development task.

### BEN — Codex

BEN's role:

- Review
- Architecture
- Business-rule validation
- Data-model validation
- Testing and verification
- Identifying conflicts, risks, duplication, or scope creep

Ben should generally avoid implementing features being actively developed by Cleo unless explicitly assigned implementation work.

### CLEO — Cursor

CLEO's role:

- Primary implementation engineer
- Application development
- UI implementation
- API implementation
- Database implementation
- Migrations
- Integration
- Bug fixes
- Testing of implemented work

## Product Scope

This application is a **simple insurance commission tracking and reporting tool**.

Core functionality includes:

- Groups / Accounts
- Carriers
- Lines of Business
- Agents
- Account Managers
- Agent-to-group relationships
- Agent compensation / splits
- Commission records
- Gross commission
- Agent compensation
- Agency net commission
- Paid commission months
- Premium / coverage months when available
- Missing commission tracking
- Excel imports
- CSV imports
- PDF imports
- Manual commission entry
- Commission reporting
- Audit-oriented views and exports

Reporting should ultimately support:

- Month
- Group
- Carrier
- LOB
- Agent
- Agency

The original uploaded commission statements should remain identifiable and accessible.

The application may eventually provide agency-income information to a separate budgeting application.

Budgeting itself is **not** part of this application.

Do not expand the application into:

- CRM
- AMS
- General accounting
- Payroll
- Policy servicing
- Compliance management
- Contact management
- General task management
- Multitenant SaaS infrastructure

unless specifically directed by the Product Owner through ChatGPT.

## Business Principles

- Commission records are primarily organized according to **paid month**: the month the agency received the commission.
- Premium / coverage month is separate when known.
- Do not assume paid month and premium month are the same.
- Financial history must remain stable.
- Changing a current agent split or assignment must never silently alter historical commission records.
- Persisted historical commission records should retain the compensation values and rates actually used.
- Money must use the project's exact-money representation.
- Use stable database IDs rather than mutable display names for relationships.
- Avoid unnecessary complexity.
- Build for the current requirements rather than hypothetical future functionality.

## Development Process

- Work one assigned task at a time.
- Do not automatically begin the next recommended task.
- Do not create multi-phase implementations unless specifically requested.
- Inspect existing code before creating new functionality.
- Reuse existing architecture, components, repositories, domain functions, APIs, and patterns when appropriate.
- Do not create duplicate implementations.
- Prefer additive database migrations.
- Never rewrite an already-applied migration unless explicitly instructed and safe.
- Do not redesign unrelated UI.
- Do not refactor unrelated working code simply because another implementation is preferred.
- Do not add speculative features.

## Parallel Work

Ben and Cleo may work simultaneously.

- Each task should identify the area assigned to that agent.
- Do not modify files or architecture actively assigned to the other agent unless required.
- If work would materially conflict with the other agent's assigned area, stop that portion of the task.
- Document the conflict in the handoff report.
- Allow ChatGPT and the Product Owner to decide how to proceed.
- Do not independently resolve cross-agent architectural conflicts.

## Project Documentation

Before substantial work, consult as relevant:

- `AGENTS.md`
- `PROJECT.md`
- `DATA_MODEL.md`
- `BUILD_STATUS.md`

The actual codebase remains the source of truth for what currently exists.

If documentation disagrees with implementation, report the discrepancy. Do not blindly implement stale documentation.

`BUILD_STATUS.md` should only claim functionality that has actually been verified.

## Validation

For implementation tasks, run relevant:

- Tests
- Typecheck
- Lint
- Production build

Do not claim something works unless it was verified.

Financial calculations should receive focused testing.

## Reporting to ChatGPT

Every assigned task ends with a copy-ready report.

BEN must end with:

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

Cleo must end with:

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

Reports should be concise and factual.

- Do not include internal reasoning.
- Do not provide long future roadmaps.
- Recommendations are recommendations only.
- ChatGPT and the Product Owner determine what happens next.
