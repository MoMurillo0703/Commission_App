# Commissions App

## Purpose

Commissions App is a simple internal insurance commission tracking and reporting tool. It should import carrier commission data, reconcile that data to agency-owned reference records, calculate agent compensation and agency net commission, identify expected commissions that are missing, and produce reliable operational reports and exports.

## In scope

- Groups / accounts
- Carriers
- Lines of business
- Agents
- Agent-to-account relationships
- Commission records
- Agent compensation and splits
- Gross commission and agency net commission
- Missing commission tracking
- PDF import
- Excel and CSV import
- Manual commission entry
- Monthly, group, carrier, line-of-business, and agent reporting
- Year-to-date and month-over-month reporting
- Data export suitable for later use by a separate budgeting application

## Operating boundaries

The application is a commission subledger and reporting tool. It is explicitly not:

- A customer relationship management system (CRM)
- An agency management system (AMS)
- A general ledger, payroll system, or accounting platform
- A budgeting or forecasting application
- A benefits compliance or legal-content platform
- A policy administration, enrollment, claims, or case-management system

Contacts, activities, tasks, policy servicing, invoices, disbursements, and general accounting are outside scope unless a minimal reference field is strictly required to identify a commission record.

## Current implementation boundary

The repository uses Postgres/Drizzle for groups, carriers, lines of business, agents, account managers, effective-dated compensation agreements, imported statements, and commission records. Commission amounts use integer cents and compensation rates use basis points. CSV, XLSX, and readable text-based PDF statements can enter the same review and posting workflow. Scanned/image-only PDFs and legacy XLS originals are retained but are not parsed. Missing-commission reconciliation, required reporting, and export are not implemented.

## Core accuracy principles

- Store money in integer cents or an exact database decimal type; do not use binary floating-point for persisted financial values.
- Preserve the source statement, source row identity, import batch, and raw source values for traceability.
- Use stable record identifiers and foreign keys rather than names to relate carriers, groups, lines of business, and agents.
- Make unassigned and unmatched values explicit; never silently infer a relationship.
- Separate gross commission, agent compensation, and agency net commission. Agency net must be derived from auditable compensation allocations.
- Prevent duplicate posting of the same statement or source row.
- A missing commission is an expected-versus-received reconciliation result, not merely an unassigned imported row.
