# UX Principles

Authoritative owner: **Alex**, with **Mo** acceptance of product language.

## Normal statement path

Read → interpret → review **exceptions** → confirm → post.

Manual column mapping and PDF layout help are **advanced fallback**, not the default PDF experience.

## Review only what is new

Known groups, coverage labels, and layouts should not be re-decided every month. Today that reuse is partial (saved layouts + carrier coverage aliases). Do not pretend the full teach-once product is finished.

## Do not invent data

Unmatched names stay unmatched until Mo confirms create or match. Creating a group does not create compensation or assignments.

Statement columns do not set producer splits. Show calculated compensation; configure terms on Compensation.

## Paid month is the organizing month

Screens that talk about “this statement” use paid month. Premium/coverage month is extra when present.

## Busy states must end

Upload, preview, confirm, and post must leave “Reading and saving…” / “Working…” if the server times out, returns HTML, or fails. Show a short actionable error. Do not automatically retry a write.

## Historical screens tell the truth

A fully posted statement must not read as an in-progress import. KD-001 is fixed: posted statements read as posted.

## Compensation setup

A missing or incomplete Group + LOB plan should eventually be a **soft reminder**. Do not present “no plan” as if a hidden 100% producer agreement exists. Current settlement when nothing is on file is 100% Agency. See [`BUSINESS_RULES.md`](BUSINESS_RULES.md).

## Scope of chrome

Keep navigation to commission work: Overview, Statements, Groups, Carriers, People, Compensation, Reports. Do not add CRM/task chrome.

A recipient commission statement is generated from posted payouts for a person and paid month. Generating or downloading it is not a payment.

## Groups and People (planned UX)

Do not dump the entire book into one People table row. Dedicated add, search, and filters are planned; they are not required to document current screens as broken if they are merely sparse.
