"use client";

import { useState } from "react";
import { formatPaidMonthLong, formatStatementMonth } from "@/domain/dates";
import { formatCents } from "@/domain/money";
import type { AgencyOwnerDrilldownLine, MonthlyReconciliation, NamedBusinessPerson } from "@/domain/businessCompensation";
import { monthlyAuditStatusCopy, monthlyAuditSummaryRows } from "@/domain/monthlyCompensationAudit";
import { personKey } from "@/domain/agencyOwner";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage } from "@/lib/apiClient";

export function CompensationReconciliation() {
  const [paidMonth, setPaidMonth] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconciliation, setReconciliation] = useState<MonthlyReconciliation | null>(null);
  const [namedPeople, setNamedPeople] = useState<NamedBusinessPerson[]>([]);
  const [drilldown, setDrilldown] = useState<AgencyOwnerDrilldownLine[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!paidMonth) {
      setError("Choose a paid month.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetchWithDeadline(`/api/compensation-reconciliation?paidMonth=${paidMonth}`);
      const body = await readApiJson<{
        reconciliation: MonthlyReconciliation;
        drilldown: AgencyOwnerDrilldownLine[];
        namedPeople?: NamedBusinessPerson[];
        message?: string;
      }>(response);
      if (!response.ok) {
        setError(httpFailureMessage(response.status, body.message));
        return;
      }
      setReconciliation(body.reconciliation);
      setDrilldown(body.drilldown);
      setNamedPeople(body.namedPeople ?? []);
    } catch (loadError) {
      setError(requestFailureMessage(loadError, "Unable to load the monthly compensation audit."));
    } finally {
      setBusy(false);
    }
  }

  const summaryRows = reconciliation
    ? monthlyAuditSummaryRows({
      postedCommissionCount: reconciliation.postedCommissionCount,
      grossCents: reconciliation.grossCents,
      moAgencyCents: reconciliation.moAgencyCents,
      named: namedPeople.map((person) => ({
        label: person.label,
        cents: reconciliation.namedCents[personKey(person)] ?? 0,
      })),
      otherCents: reconciliation.otherCents,
      fallbackAgencyCents: reconciliation.fallbackAgencyCents,
      legacyNoPayoutCents: reconciliation.legacyNoPayoutCents,
      inconsistentCents: reconciliation.inconsistentCents,
      underDistributedCents: reconciliation.underDistributedCents,
      overDistributedCents: reconciliation.overDistributedCents,
      unclassifiedCents: reconciliation.unclassifiedCents,
      differenceCents: reconciliation.differenceCents,
    })
    : [];

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Audit</p>
          <h2>Monthly Compensation Audit</h2>
          <p>
            Review whether commissions received during a Paid Month reconcile to the appropriate people
            and identify records that need review.
          </p>
        </div>
      </div>
      <label>
        Paid month
        <input type="month" value={paidMonth} onChange={(event) => setPaidMonth(event.target.value)} />
      </label>
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={() => void load()}>Review month</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {busy && <p className="muted-note">Loading…</p>}
      {reconciliation && (
        <>
          <h3>{formatStatementMonth(reconciliation.paidMonth)}</h3>
          <p className={reconciliation.payableReady ? "form-success" : "form-error"}>
            {monthlyAuditStatusCopy(reconciliation.payableReady, reconciliation.payableReadyMessage)}
          </p>
          {reconciliation.missingOwnerMonths.length > 0 && (
            <p className="form-error">
              {reconciliation.missingOwnerMonths.length === 1
                ? `Agency owner is not configured for ${formatPaidMonthLong(reconciliation.missingOwnerMonths[0]!)}.`
                : `Agency owner is not configured for ${reconciliation.missingOwnerMonths.map((month) => formatPaidMonthLong(month)).join(", ")}.`}
            </p>
          )}
          <table>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.label}><th>{row.label}</th><td>{row.value}</td></tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="secondary" onClick={() => setOpen((current) => !current)}>
            {open ? "Hide" : "Show"} line detail
          </button>
          {open && (
            <table>
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>Group</th>
                  <th>Line</th>
                  <th>Gross</th>
                  <th>Mo</th>
                  <th>Other people</th>
                  <th>Needs review</th>
                </tr>
              </thead>
              <tbody>
                {drilldown.map((line, index) => (
                  <tr key={`${line.carrierName}:${line.groupName}:${line.lineOfBusinessName}:${index}`}>
                    <td>{line.carrierName}</td>
                    <td>{line.groupName}</td>
                    <td>{line.lineOfBusinessName}</td>
                    <td>{formatCents(line.grossCents)}</td>
                    <td>{formatCents(line.moAgencyCents)}</td>
                    <td>{formatCents(line.otherCents)}</td>
                    <td>{formatCents(line.fallbackAgencyCents + line.legacyNoPayoutCents + line.differenceCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
