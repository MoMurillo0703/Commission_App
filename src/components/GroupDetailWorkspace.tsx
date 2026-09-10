"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { AllocationRecipientEditor } from "./AllocationRecipientEditor";
import type { GroupCommissionRow, GroupCompensationLineView, GroupWorkspaceLookups } from "@/data/groupWorkspace";
import type { AllocationView } from "@/data/allocations";
import type { Group } from "@/db/schema";
import {
  defaultAllocationDraft,
  draftFromAllocationEntries,
  allocationEntryPayload,
  type DraftRecipient,
} from "@/domain/allocationEditor";
import { allocationTotals } from "@/domain/allocations";
import { formatStatementMonth } from "@/domain/dates";
import { groupEditDraftFrom } from "@/domain/groupEdit";
import {
  canSaveExplicitSplit,
  compensationChangeConflictMessage,
  splitEditProgressLabel,
  suggestedCompensationChangeStart,
} from "@/domain/groupCompensationStatus";
import { formatCents, bpsToPercentString, parsePercentToBps } from "@/domain/money";
import { reportsHref } from "@/domain/reportDeepLink";

type Tab = "overview" | "compensation" | "commissions";

function draftBps(entries: DraftRecipient[]) {
  return entries.reduce((sum, entry) => {
    try {
      return sum + parsePercentToBps(entry.percent || "0");
    } catch {
      return sum;
    }
  }, 0);
}

export function GroupDetailWorkspace({
  asOfMonth,
  group,
  identities,
  carrierNames,
  lineOfBusinessNames,
  compensationLines,
  commissions,
  lookups,
  allocations,
}: {
  asOfMonth: string;
  group: Group;
  identities: string[];
  carrierNames: string[];
  lineOfBusinessNames: string[];
  compensationLines: GroupCompensationLineView[];
  commissions: GroupCommissionRow[];
  lookups: GroupWorkspaceLookups;
  allocations: AllocationView[];
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => groupEditDraftFrom(group));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [changeLineId, setChangeLineId] = useState<number | null>(null);
  const [effectiveStart, setEffectiveStart] = useState(asOfMonth);
  const [splitEntries, setSplitEntries] = useState<DraftRecipient[]>(defaultAllocationDraft().entries);

  const allocatedBps = useMemo(() => draftBps(splitEntries), [splitEntries]);
  const changing = compensationLines.find((line) => line.lineOfBusinessId === changeLineId) ?? null;

  function startChange(line: GroupCompensationLineView) {
    setChangeLineId(line.lineOfBusinessId);
    setEffectiveStart(suggestedCompensationChangeStart(asOfMonth, line.current?.effectiveStart ?? null));
    setSplitEntries(line.current
      ? draftFromAllocationEntries(line.current.entries.map((entry) => ({
        recipientType: entry.recipientType as "agency" | "person" | "team",
        personKind: entry.personKind as "agent" | "account_manager" | null,
        personId: entry.personId,
        teamId: entry.teamId,
        compensationPercent: bpsToPercentString(entry.compensationBps),
      })))
      : [{ recipientType: "agency", personKind: "", personId: "", teamId: "", percent: "100" }]);
    setError("");
    setSuccess("");
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(`/api/groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        groupNumber: draft.groupNumber,
        notes: draft.notes,
        accountManagerId: draft.accountManagerId ? Number(draft.accountManagerId) : null,
        primaryAgentId: draft.primaryAgentId ? Number(draft.primaryAgentId) : null,
      }),
    });
    const body = await response.json() as { message?: string };
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save this group.");
      return;
    }
    window.location.reload();
  }

  async function saveCompensation(event: FormEvent) {
    event.preventDefault();
    if (!changing) return;
    if (!canSaveExplicitSplit(allocatedBps) || allocationTotals(splitEntries.map((entry) => ({
      compensationBps: (() => {
        try { return parsePercentToBps(entry.percent || "0"); } catch { return 0; }
      })(),
    }))).over) {
      setError("An explicit allocation must total exactly 100% and cannot exceed 100%.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const payload = {
      groupId: group.id,
      lineOfBusinessId: changing.lineOfBusinessId,
      effectiveStart,
      status: "active",
      entries: allocationEntryPayload(splitEntries),
    };
    const response = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as { message?: string };
    setBusy(false);
    if (!response.ok) {
      const explained = compensationChangeConflictMessage({
        requestedStart: effectiveStart,
        siblings: allocations
          .filter((row) => row.groupId === group.id && row.lineOfBusinessId === changing.lineOfBusinessId)
          .map((row) => ({
            id: row.id,
            groupId: row.groupId,
            lineOfBusinessId: row.lineOfBusinessId,
            effectiveStart: row.effectiveStart,
            effectiveEnd: row.effectiveEnd,
            status: row.status,
            entries: row.entries.map((entry) => ({
              recipientType: entry.recipientType,
              personKind: entry.personKind,
              personId: entry.personId,
              teamId: entry.teamId,
              compensationBps: entry.compensationBps,
            })),
          })),
        requested: {
          groupId: group.id,
          lineOfBusinessId: changing.lineOfBusinessId,
          effectiveStart,
          entries: allocationEntryPayload(splitEntries).map((entry) => ({
            recipientType: entry.recipientType,
            personKind: entry.personKind,
            personId: entry.personId,
            teamId: entry.teamId,
            compensationBps: parsePercentToBps(entry.compensationPercent || "0"),
          })),
        },
      });
      setError(explained ?? body.message ?? "Unable to save compensation.");
      return;
    }
    window.location.reload();
  }

  return (
    <section className="panel">
      <p className="eyebrow"><Link href="/groups">Groups</Link></p>
      <h2>{group.name}</h2>
      <p>Assignment is not compensation. Posted commission history is shown as received, without recalculating earnings here.</p>
      <div className="workspace-tabs" role="tablist">
        {(["overview", "compensation", "commissions"] as const).map((item) => (
          <button key={item} type="button" className={tab === item ? "" : "secondary"} onClick={() => setTab(item)}>
            {item === "overview" ? "Overview" : item === "compensation" ? "Compensation" : "Commissions"}
          </button>
        ))}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {success ? <p className="form-success">{success}</p> : null}

      {tab === "overview" && (
        <>
          <dl className="detail-list">
            <div><dt>Group name</dt><dd>{group.name}</dd></div>
            <div><dt>Legacy group number</dt><dd>{group.groupNumber || "—"}</dd></div>
            <div><dt>Carrier-scoped numbers</dt><dd>{identities.join(", ") || "—"}</dd></div>
            <div><dt>Observed carriers</dt><dd>{carrierNames.join(", ") || "—"}</dd></div>
            <div><dt>Relevant lines of business</dt><dd>{lineOfBusinessNames.join(", ") || "—"}</dd></div>
            <div><dt>Primary Agent</dt><dd>{lookups.agents.find((agent) => agent.id === group.primaryAgentId)?.name ?? "—"}</dd></div>
            <div><dt>Account Manager</dt><dd>{lookups.accountManagers.find((manager) => manager.id === group.accountManagerId)?.name ?? "—"}</dd></div>
            <div><dt>Notes</dt><dd>{group.notes || "—"}</dd></div>
          </dl>
          {!editing ? (
            <div className="form-actions">
              <button type="button" onClick={() => setEditing(true)}>Edit Group</button>
            </div>
          ) : (
            <form className="form-grid form-grid-wide" onSubmit={saveGroup}>
              <label>
                Group name
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required />
              </label>
              <label>
                Legacy group number
                <input value={draft.groupNumber} onChange={(event) => setDraft({ ...draft, groupNumber: event.target.value })} />
              </label>
              <label>
                Primary Agent
                <select value={draft.primaryAgentId} onChange={(event) => setDraft({ ...draft, primaryAgentId: event.target.value })}>
                  <option value="">Unassigned</option>
                  {lookups.agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </label>
              <label>
                Account Manager
                <select value={draft.accountManagerId} onChange={(event) => setDraft({ ...draft, accountManagerId: event.target.value })}>
                  <option value="">Unassigned</option>
                  {lookups.accountManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
                </select>
              </label>
              <label className="full">
                Notes
                <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
              </label>
              <div className="form-actions full">
                <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Group"}</button>
                <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}

      {tab === "compensation" && (
        <>
          <p className="muted-note">Current Paid Month: {formatStatementMonth(asOfMonth)}. Agency 100% default is not the same as an explicit Agency 100% allocation.</p>
          {compensationLines.length === 0 ? (
            <p className="empty">No relevant lines of business are on file for this Group yet.</p>
          ) : compensationLines.map((line) => (
            <article key={line.lineOfBusinessId} className="lob-compensation-card">
              <header>
                <strong>{line.name}</strong>
                <span className={`pill ${line.invalid ? "review" : line.configured ? "posted" : "mapped"}`}>{line.statusLabel}</span>
              </header>
              <p>{line.label}</p>
              {line.current ? (
                <p className="muted-note">
                  Effective {formatStatementMonth(line.current.effectiveStart)}
                  {line.current.effectiveEnd ? ` → ${formatStatementMonth(line.current.effectiveEnd)}` : " → Present"}
                </p>
              ) : null}
              {line.future ? (
                <p className="muted-note">Future: {line.future.entries.length} recipient{line.future.entries.length === 1 ? "" : "s"} from {formatStatementMonth(line.future.effectiveStart)}.</p>
              ) : null}
              {line.historical.length > 0 ? (
                <p className="muted-note">
                  Historical: {line.historical.map((item) => `${formatStatementMonth(item.effectiveStart)} → ${item.effectiveEnd ? formatStatementMonth(item.effectiveEnd) : ""}`).join("; ")}
                </p>
              ) : null}
              <button type="button" className="secondary" onClick={() => startChange(line)}>Change Compensation</button>
            </article>
          ))}
          {changing && (
            <form className="form-grid" onSubmit={saveCompensation}>
              <p><strong>Change compensation for {changing.name}</strong></p>
              {changing.current ? (
                <p className="muted-note">Current: {changing.recipientSummary}. A later effective start closes this period and keeps that history.</p>
              ) : (
                <p className="muted-note">No explicit current allocation. Saving will create one.</p>
              )}
              <label>
                Effective start
                <input type="month" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} required />
              </label>
              <AllocationRecipientEditor
                entries={splitEntries}
                agents={lookups.agents}
                accountManagers={lookups.accountManagers}
                teams={lookups.teams}
                onChange={setSplitEntries}
              />
              <p className={allocatedBps === 10000 ? "form-success" : "form-error"}>{splitEditProgressLabel(allocatedBps)}</p>
              <div className="form-actions">
                <button type="submit" disabled={busy || !canSaveExplicitSplit(allocatedBps)}>
                  {busy ? "Saving…" : "Save compensation"}
                </button>
                <button type="button" className="secondary" onClick={() => setChangeLineId(null)}>Cancel</button>
              </div>
            </form>
          )}
        </>
      )}

      {tab === "commissions" && (
        <>
          <p className="muted-note">
            Paid Month is authoritative. Coverage or source period is context only.
            {" "}
            <Link href={reportsHref({ groupId: group.id, paidMonth: asOfMonth })}>Open Reports</Link>
          </p>
          {commissions.length === 0 ? (
            <p className="empty">No posted commissions for this Group.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Paid Month</th>
                  <th>Carrier</th>
                  <th>LOB</th>
                  <th>Commission</th>
                  <th>Coverage month</th>
                  <th>Source period</th>
                  <th>Statement</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((row) => (
                  <tr key={row.id}>
                    <td>{formatStatementMonth(row.statementMonth)}</td>
                    <td>{row.carrierName}</td>
                    <td>{row.lineOfBusinessName}</td>
                    <td>{formatCents(row.grossCommissionCents)}</td>
                    <td>{row.premiumMonth ? formatStatementMonth(row.premiumMonth) : "—"}</td>
                    <td>{row.sourcePeriodLabel || "—"}</td>
                    <td>{row.statementName || (row.importStatementId ? `Statement ${row.importStatementId}` : "—")}</td>
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
