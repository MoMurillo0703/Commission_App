"use client";

import { useState } from "react";
import { AGENCY_OWNER_LABEL } from "@/domain/agencyOwner";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
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

  const unresolved = (reconciliation?.unresolvedCents ?? 0) + (reconciliation?.fallbackAgencyCents ?? 0);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Monthly control</p>
          <h2>Compensation reconciliation</h2>
          <p>
            {AGENCY_OWNER_LABEL} is Mo direct + Mo team + legitimate Agency-retained money.
            Team parents are ignored. Fallback Agency 100% and missing payouts stay unresolved.
          </p>
          {!ownerConfigured && (
            <p className="muted-note">Agency owner identity is not configured. Combined {AGENCY_OWNER_LABEL} needs a durable owner person ID.</p>
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
          <table>
            <tbody>
              <tr><th>Total commission received</th><td>{formatCents(reconciliation.grossCents)}</td></tr>
              <tr><th>{AGENCY_OWNER_LABEL}</th><td>{formatCents(reconciliation.moAgencyCents)}</td></tr>
              {namedPeople.map((person) => (
                <tr key={personKey(person)}>
                  <th>{person.label}</th>
                  <td>{formatCents(reconciliation.namedCents[personKey(person)] ?? 0)}</td>
                </tr>
              ))}
              <tr><th>Other recipients</th><td>{formatCents(reconciliation.otherCents)}</td></tr>
              <tr><th>Unresolved</th><td>{formatCents(unresolved)}</td></tr>
              <tr><th>Total accounted for</th><td>{formatCents(reconciliation.accountedCents)}</td></tr>
              <tr><th>Difference</th><td>{formatCents(reconciliation.differenceCents)}</td></tr>
            </tbody>
          </table>
          <p className="muted-note">
            {AGENCY_OWNER_LABEL} breakdown: direct {formatCents(reconciliation.moDirectCents)} · team {formatCents(reconciliation.moTeamCents)} · Agency retained {formatCents(reconciliation.agencyRetainedCents)}.
            Fallback Agency {formatCents(reconciliation.fallbackAgencyCents)} is unresolved, not intentional Mo compensation.
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
