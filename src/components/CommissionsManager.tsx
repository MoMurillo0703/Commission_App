"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { CommissionView } from "@/data/commissions";
import type { Agent, Carrier, Group, LineOfBusiness } from "@/db/schema";
import { resolveCompensationAgreement } from "@/domain/agreements";
import { formatPaidMonthLong, formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString, centsToDollarString, formatCents } from "@/domain/money";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

type Props = {
  initial: CommissionView[];
  paidMonth?: string;
  refreshToken?: number;
  groups: Group[];
  carriers: Carrier[];
  linesOfBusiness: LineOfBusiness[];
  agents: Agent[];
  agreements: AgreementView[];
};

const emptyForm = {
  statementMonth: "",
  groupId: "",
  carrierId: "",
  lineOfBusinessId: "",
  agentId: "",
  premium: "",
  grossCommission: "",
  compensationPercent: "",
  sourceReference: "",
  notes: "",
};

export function CommissionsManager({ initial, paidMonth, refreshToken = 0, groups, carriers, linesOfBusiness, agents, agreements }: Props) {
  const [remoteRows, setRemoteRows] = useState<CommissionView[] | null>(null);
  const [remoteMonth, setRemoteMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState<CommissionView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = remoteMonth === (paidMonth ?? null) && remoteRows
    ? remoteRows
    : (paidMonth ? initial.filter((row) => row.statementMonth === paidMonth) : initial);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const query = paidMonth ? `?paidMonth=${encodeURIComponent(paidMonth)}` : "";
        const response = await fetchWithDeadline(`/api/commissions${query}`);
        if (!response.ok || cancelled) return;
        const next = await readApiJson<CommissionView[]>(response);
        if (!cancelled) {
          setRemoteRows(next);
          setRemoteMonth(paidMonth ?? null);
        }
      } catch {
        // Keep the last visible month list if refresh fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, paidMonth]);
  const ready = groups.length > 0 && carriers.length > 0 && linesOfBusiness.length > 0;
  const agreementCandidates = useMemo(
    () => agreements.map((agreement) => ({
      id: agreement.id,
      groupId: agreement.groupId,
      agentId: agreement.agentId,
      lineOfBusinessId: agreement.lineOfBusinessId,
      compensationBps: agreement.compensationBps,
      effectiveStart: agreement.effectiveStart,
      effectiveEnd: agreement.effectiveEnd,
      status: agreement.status,
    })),
    [agreements],
  );

  function setField(name: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      const next = { ...current, [name]: value };
      if (editing) return next;
      const selectedGroup = groups.find((group) => String(group.id) === (name === "groupId" ? value : next.groupId));
      if (name === "groupId" && selectedGroup?.primaryAgentId) {
        next.agentId = String(selectedGroup.primaryAgentId);
      }
      const selectedAgentId = name === "agentId" ? value : next.agentId;
      if (name === "groupId" || name === "agentId" || name === "lineOfBusinessId" || name === "statementMonth") {
        if (!selectedAgentId) {
          next.compensationPercent = "";
        } else {
          const agreement = resolveCompensationAgreement(agreementCandidates, {
            groupId: Number(name === "groupId" ? value : next.groupId),
            agentId: Number(selectedAgentId),
            lineOfBusinessId: Number(name === "lineOfBusinessId" ? value : next.lineOfBusinessId),
            paidMonth: name === "statementMonth" ? value : next.statementMonth,
          });
          next.compensationPercent = agreement ? bpsToPercentString(agreement.compensationBps) : "";
        }
      }
      return next;
    });
  }

  function startEdit(row: CommissionView) {
    setEditing(row);
    setForm({
      statementMonth: row.statementMonth,
      groupId: String(row.groupId),
      carrierId: String(row.carrierId),
      lineOfBusinessId: String(row.lineOfBusinessId),
      agentId: row.agentId == null ? "" : String(row.agentId),
      premium: row.premiumCents == null ? "" : centsToDollarString(row.premiumCents),
      grossCommission: centsToDollarString(row.grossCommissionCents),
      compensationPercent: row.compensationBps == null ? "" : bpsToPercentString(row.compensationBps),
      sourceReference: row.sourceReference ?? "",
      notes: row.notes ?? "",
    });
    setError("");
  }

  function reset() {
    setEditing(null);
    setForm(emptyForm);
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(editing ? `/api/commissions/${editing.id}` : "/api/commissions", {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statementMonth: form.statementMonth || paidMonth || "",
            groupId: form.groupId,
            carrierId: form.carrierId,
            lineOfBusinessId: form.lineOfBusinessId,
            agentId: form.agentId ? Number(form.agentId) : null,
            premium: form.premium,
            grossCommission: form.grossCommission,
            compensationPercent: form.compensationPercent,
            sourceReference: form.sourceReference,
            notes: form.notes,
          }),
        });
        const body = await readApiJson<{ message?: string }>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        const query = paidMonth ? `?paidMonth=${encodeURIComponent(paidMonth)}` : "";
        const listed = await fetchWithDeadline(`/api/commissions${query}`);
        if (listed.ok) {
          setRemoteRows(await readApiJson<CommissionView[]>(listed));
          setRemoteMonth(paidMonth ?? null);
        }
        reset();
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to save."));
    }
  }

  return (
    <section className="panel">
      {paidMonth && (
        <div>
          <p className="eyebrow">Posted commissions</p>
          <h2>{formatPaidMonthLong(paidMonth)}</h2>
          <p>Commission records posted into this paid month. They appear here after a statement posts successfully.</p>
        </div>
      )}
      {!ready ? (
        <p className="empty">Add a group, carrier, and line of business before recording a commission.</p>
      ) : (
        <form className="form-grid form-grid-wide" onSubmit={save}>
          <label>
            Statement month
            <input type="month" value={form.statementMonth || paidMonth || ""} onChange={(event) => setField("statementMonth", event.target.value)} required />
          </label>
          <label>
            Group
            <select value={form.groupId} onChange={(event) => setField("groupId", event.target.value)} required>
              <option value="">Select a group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Carrier
            <select value={form.carrierId} onChange={(event) => setField("carrierId", event.target.value)} required>
              <option value="">Select a carrier</option>
              {carriers.map((carrier) => (
                <option key={carrier.id} value={carrier.id}>
                  {carrier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Line of business
            <select value={form.lineOfBusinessId} onChange={(event) => setField("lineOfBusinessId", event.target.value)} required>
              <option value="">Select a line</option>
              {linesOfBusiness.map((line) => (
                <option key={line.id} value={line.id}>
                  {line.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select value={form.agentId} onChange={(event) => setField("agentId", event.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Premium
            <input value={form.premium} onChange={(event) => setField("premium", event.target.value)} placeholder="0.00" />
          </label>
          <label>
            Gross commission
            <input value={form.grossCommission} onChange={(event) => setField("grossCommission", event.target.value)} placeholder="0.00" required />
          </label>
          <label>
            Agent split %
            <input value={form.compensationPercent} onChange={(event) => setField("compensationPercent", event.target.value)} placeholder="40" disabled={!form.agentId} />
          </label>
          <label>
            Source reference
            <input value={form.sourceReference} onChange={(event) => setField("sourceReference", event.target.value)} />
          </label>
          <label className="full">
            Notes
            <textarea value={form.notes} onChange={(event) => setField("notes", event.target.value)} rows={3} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add commission"}</button>
            {editing && (
              <button type="button" className="secondary" onClick={reset}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {rows.length === 0 ? (
        <p className="empty">{paidMonth ? `No posted commissions for ${formatPaidMonthLong(paidMonth)} yet.` : "No commission records yet."}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th>Group</th>
              <th>Carrier</th>
              <th>Line</th>
              <th>Agent</th>
              <th>Gross</th>
              <th>Agent pay</th>
              <th>Agency net</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatStatementMonth(row.statementMonth)}</td>
                <td>
                  <strong>{row.groupName}</strong>
                </td>
                <td>{row.carrierName}</td>
                <td>{row.lineOfBusinessName}</td>
                <td>{row.agentName ?? "Unassigned"}</td>
                <td>{formatCents(row.grossCommissionCents)}</td>
                <td>{formatCents(row.agentCompensationCents)}</td>
                <td>{formatCents(row.agencyNetCents)}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => startEdit(row)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
