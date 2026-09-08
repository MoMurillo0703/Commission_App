"use client";

import { useState } from "react";
import { AGENCY_OWNER_LABEL } from "@/domain/agencyOwner";
import { formatCents } from "@/domain/money";
import { formatPaidMonthLong, formatStatementMonth } from "@/domain/dates";
import type { AgencyOwnerDrilldownLine, MonthlyReconciliation, NamedBusinessPerson } from "@/domain/businessCompensation";
import { personKey } from "@/domain/agencyOwner";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage } from "@/lib/apiClient";

export function CompensationReconciliation({
  namedPeople,
  ownerConfigured,
}: {
  namedPeople: NamedBusinessPerson[];
  ownerConfigured: boolean;
}) {
  const [paidMonth, setPaidMonth] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reconciliation, setReconciliation] = useState<MonthlyReconciliation | null>(null);
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
        message?: string;
      }>(response);
      if (!response.ok) {
        setError(httpFailureMessage(response.status, body.message));
        return;
      }
      setReconciliation(body.reconciliation);
      setDrilldown(body.drilldown);
    } catch (loadError) {
      setError(requestFailureMessage(loadError, "Unable to load monthly reconciliation."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Monthly control</p>
          <h2>Compensation reconciliation</h2>
          <p>
            {AGENCY_OWNER_LABEL} is Mo direct + Mo team + legitimate allocated Agency-retained money.
            Team parents are ignored. Historical Agency Fallback and Legacy No-Payout Snapshot stay unresolved.
          </p>
          {!ownerConfigured && (
            <p className="muted-note">Agency owner identity is not configured for the selected paid month. Combined {AGENCY_OWNER_LABEL} needs a confirmed owner row.</p>
          )}
        </div>
      </div>
      <label>
        Paid month
        <input type="month" value={paidMonth} onChange={(event) => setPaidMonth(event.target.value)} />
      </label>
      <div className="form-actions">
        <button type="button" disabled={busy} onClick={() => void load()}>Reconcile month</button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {busy && <p className="muted-note">Loading…</p>}
      {reconciliation && (
        <>
          <h3>{formatStatementMonth(reconciliation.paidMonth)}</h3>
          <p className={reconciliation.payableReady ? "form-success" : "form-error"}>
            {reconciliation.payableReady ? "PAYABLE-READY" : reconciliation.payableReadyMessage}
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
              <tr><th>Posted commissions</th><td>{reconciliation.postedCommissionCount}</td></tr>
              <tr><th>Posted gross</th><td>{formatCents(reconciliation.grossCents)}</td></tr>
              <tr><th>{AGENCY_OWNER_LABEL} settled</th><td>{formatCents(reconciliation.moAgencyCents)}</td></tr>
              {namedPeople.map((person) => (
                <tr key={personKey(person)}>
                  <th>{person.label} settled</th>
                  <td>{formatCents(reconciliation.namedCents[personKey(person)] ?? 0)}</td>
                </tr>
              ))}
              <tr><th>Other settled</th><td>{formatCents(reconciliation.otherCents)}</td></tr>
              <tr><th>Historical Agency Fallback</th><td>{formatCents(reconciliation.fallbackAgencyCents)}</td></tr>
              <tr><th>LEGACY — NO PAYOUT SNAPSHOT</th><td>{formatCents(reconciliation.legacyNoPayoutCents)}</td></tr>
              <tr><th>Inconsistent / unresolved Agency</th><td>{formatCents(reconciliation.inconsistentCents)}</td></tr>
              <tr><th>Under-distributed</th><td>{formatCents(reconciliation.underDistributedCents)}</td></tr>
              <tr><th>Over-distributed</th><td>{formatCents(reconciliation.overDistributedCents)}</td></tr>
              <tr><th>Unclassified</th><td>{formatCents(reconciliation.unclassifiedCents)}</td></tr>
              <tr><th>Accounted classified total</th><td>{formatCents(reconciliation.accountedClassifiedTotalCents)}</td></tr>
              <tr><th>Reconciliation difference</th><td>{formatCents(reconciliation.differenceCents)}</td></tr>
              <tr><th>Canonical payout total</th><td>{formatCents(reconciliation.canonicalPayoutTotalCents)}</td></tr>
            </tbody>
          </table>
          <p className="muted-note">
            {AGENCY_OWNER_LABEL} breakdown: direct {formatCents(reconciliation.moDirectCents)} · team {formatCents(reconciliation.moTeamCents)} · Agency retained {formatCents(reconciliation.agencyRetainedCents)}.
            Difference is posted gross minus independently classified totals. Unresolved classes are not Mo pay.
          </p>
          <button type="button" className="secondary" onClick={() => setOpen((current) => !current)}>
            {open ? "Hide" : "Show"} {AGENCY_OWNER_LABEL} drilldown
          </button>
          {open && (
            <table>
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>Group</th>
                  <th>LOB</th>
                  <th>Gross</th>
                  <th>Mo direct</th>
                  <th>Mo team</th>
                  <th>Agency retained</th>
                  <th>{AGENCY_OWNER_LABEL}</th>
                  <th>Other</th>
                  <th>Fallback</th>
                  <th>No payout</th>
                  <th>Distributed</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {drilldown.map((line, index) => (
                  <tr key={`${line.carrierName}:${line.groupName}:${line.lineOfBusinessName}:${index}`}>
                    <td>{line.carrierName}</td>
                    <td>{line.groupName}</td>
                    <td>{line.lineOfBusinessName}</td>
                    <td>{formatCents(line.grossCents)}</td>
                    <td>{formatCents(line.moDirectCents)}</td>
                    <td>{formatCents(line.moTeamCents)}</td>
                    <td>{formatCents(line.agencyRetainedCents)}</td>
                    <td>{formatCents(line.moAgencyCents)}</td>
                    <td>{formatCents(line.otherCents)}</td>
                    <td>{formatCents(line.fallbackAgencyCents)}</td>
                    <td>{formatCents(line.legacyNoPayoutCents)}</td>
                    <td>{formatCents(line.distributedCents)}</td>
                    <td>{formatCents(line.differenceCents)}</td>
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
