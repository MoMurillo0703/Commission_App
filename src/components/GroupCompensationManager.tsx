"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { AccountManager, Agent, Group, LineOfBusiness } from "@/db/schema";
import { formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString } from "@/domain/money";

export function GroupCompensationManager({
  groups,
  agents,
  accountManagers = [],
  linesOfBusiness,
  initial,
  selectedGroupId,
  onSelectGroup,
}: {
  groups: Group[];
  agents: Agent[];
  accountManagers?: AccountManager[];
  linesOfBusiness: LineOfBusiness[];
  initial: AgreementView[];
  selectedGroupId: number | null;
  onSelectGroup?: (id: number | null) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [localSelectedGroupId, setLocalSelectedGroupId] = useState(selectedGroupId);
  const effectiveSelectedGroupId = onSelectGroup ? selectedGroupId : localSelectedGroupId;
  const groupId = effectiveSelectedGroupId == null ? "" : String(effectiveSelectedGroupId);
  const [agentId, setAgentId] = useState("");
  const [lineOfBusinessId, setLineOfBusinessId] = useState("");
  const [compensationPercent, setCompensationPercent] = useState("");
  const [effectiveStart, setEffectiveStart] = useState("");
  const [effectiveEnd, setEffectiveEnd] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  function accountManagerName(group: Group | undefined) {
    if (!group?.accountManagerId) return "—";
    return accountManagers.find((manager) => manager.id === group.accountManagerId)?.name || "—";
  }

  const visible = useMemo(
    () => rows.filter((row) => {
      if (groupId && row.groupId !== Number(groupId)) return false;
      const needle = query.trim().toLowerCase();
      if (!needle) return true;
      const group = groups.find((item) => item.id === row.groupId);
      const managerName = group?.accountManagerId
        ? accountManagers.find((manager) => manager.id === group.accountManagerId)?.name || "—"
        : "—";
      return [row.groupName, row.agentName, row.lineOfBusinessName, managerName]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    }),
    [accountManagers, groupId, groups, query, rows],
  );

  async function refresh() {
    setRows(await fetch("/api/agreements").then((response) => response.json()));
  }

  function reset() {
    setAgentId("");
    setLineOfBusinessId("");
    setCompensationPercent("");
    setEffectiveStart("");
    setEffectiveEnd("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/agreements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: groupId ? Number(groupId) : null,
        agentId: agentId ? Number(agentId) : null,
        lineOfBusinessId: lineOfBusinessId ? Number(lineOfBusinessId) : null,
        compensationPercent,
        effectiveStart,
        effectiveEnd,
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save.");
      return;
    }
    await refresh();
    reset();
  }

  async function closeAgreement(row: AgreementView) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/agreements/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "inactive" }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to update.");
      return;
    }
    await refresh();
  }

  function periodLabel(row: AgreementView) {
    const start = formatStatementMonth(row.effectiveStart);
    return row.effectiveEnd ? `${start} – ${formatStatementMonth(row.effectiveEnd)}` : `${start} – present`;
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Compensation</p>
          <h2>Group compensation arrangements</h2>
          <p>Assignment to a group does not pay an agent. Add a dated agreement for each compensable line. Changing a split closes the prior period and keeps the old rate.</p>
        </div>
      </div>
      <form className="form-grid form-grid-wide" onSubmit={save}>
        <label>
          Group
          <select
            value={groupId}
            onChange={(event) => {
              const value = event.target.value ? Number(event.target.value) : null;
              if (onSelectGroup) onSelectGroup(value);
              else setLocalSelectedGroupId(value);
            }}
            required
          >
            <option value="">Select a group</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>
            <option value="">Select an agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Line of business
          <select value={lineOfBusinessId} onChange={(event) => setLineOfBusinessId(event.target.value)} required>
            <option value="">Select a line</option>
            {linesOfBusiness.map((line) => (
              <option key={line.id} value={line.id}>
                {line.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Split %
          <input value={compensationPercent} onChange={(event) => setCompensationPercent(event.target.value)} placeholder="40" required />
        </label>
        <label>
          Effective start
          <input type="month" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} required />
        </label>
        <label>
          Effective end
          <input type="month" value={effectiveEnd} onChange={(event) => setEffectiveEnd(event.target.value)} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : "Add arrangement"}</button>
        </div>
      </form>
      <label className="directory-controls">
        <input aria-label="Search compensation" placeholder="Search group, agent, or line" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {visible.length === 0 ? (
        <p className="empty">
          {groupId
            ? "No compensation arrangements for this group. An assigned agent still receives no split until one is added."
            : "Select a group to view or add compensation arrangements."}
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Account manager</th>
              <th>Agent</th>
              <th>Line</th>
              <th>Split</th>
              <th>Effective period</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const historical = row.status === "inactive" || row.effectiveEnd != null;
              return (
                <tr key={row.id} className={historical ? "history-row" : undefined}>
                  <td><strong>{row.groupName}</strong></td>
                  <td>{accountManagerName(groups.find((group) => group.id === row.groupId))}</td>
                  <td>
                    <strong>{row.agentName}</strong>
                  </td>
                  <td>{row.lineOfBusinessName}</td>
                  <td>{`${bpsToPercentString(row.compensationBps)}%`}</td>
                  <td>{periodLabel(row)}</td>
                  <td>
                    <span className={`pill ${row.status === "active" && !row.effectiveEnd ? "posted" : "review"}`}>
                      {row.status === "inactive" ? "Inactive" : row.effectiveEnd ? "Closed" : "Current"}
                    </span>
                  </td>
                  <td>
                    {row.status === "active" && (
                      <button type="button" className="secondary" disabled={busy} onClick={() => void closeAgreement(row)}>
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
