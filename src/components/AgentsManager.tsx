"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { Agent, Group } from "@/db/schema";
import { formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString } from "@/domain/money";

export function AgentsManager({
  initial,
  groups,
  agreements,
}: {
  initial: Agent[];
  groups: Group[];
  agreements: AgreementView[];
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initial[0]?.id ?? null);
  const [name, setName] = useState("");
  const [defaultCompensationPercent, setDefaultCompensationPercent] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const tiedGroups = useMemo(() => {
    if (selectedId == null) return [];
    const fromAssignment = groups.filter((group) => group.primaryAgentId === selectedId);
    const fromAgreements = new Set(agreements.filter((row) => row.agentId === selectedId).map((row) => row.groupId));
    const extra = groups.filter((group) => fromAgreements.has(group.id) && group.primaryAgentId !== selectedId);
    return [...fromAssignment, ...extra];
  }, [agreements, groups, selectedId]);

  const agentAgreements = useMemo(
    () => agreements.filter((row) => row.agentId === selectedId),
    [agreements, selectedId],
  );

  function startEdit(row: Agent) {
    setEditing(row);
    setSelectedId(row.id);
    setName(row.name);
    setDefaultCompensationPercent(row.defaultCompensationBps == null ? "" : bpsToPercentString(row.defaultCompensationBps));
    setNotes(row.notes ?? "");
    setError("");
  }

  function reset() {
    setEditing(null);
    setName("");
    setDefaultCompensationPercent("");
    setNotes("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(editing ? `/api/agents/${editing.id}` : "/api/agents", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, defaultCompensationPercent, notes }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save.");
      return;
    }
    setRows(await fetch("/api/agents").then((res) => res.json()));
    setSelectedId(body.id);
    reset();
  }

  function groupCount(agentId: number) {
    const assigned = groups.filter((group) => group.primaryAgentId === agentId).map((group) => group.id);
    const agreed = agreements.filter((row) => row.agentId === agentId).map((row) => row.groupId);
    return new Set([...assigned, ...agreed]).size;
  }

  return (
    <section className="panel">
      <form className="form-grid" onSubmit={save}>
        <label>
          Agent name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Agent-level default split %
          <input value={defaultCompensationPercent} onChange={(event) => setDefaultCompensationPercent(event.target.value)} placeholder="optional" />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add agent"}</button>
          {editing && (
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="empty">No agents on file yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Groups</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selectedId === row.id ? "selected-row" : undefined}>
                <td>
                  <button type="button" className="linkish" onClick={() => setSelectedId(row.id)}>
                    <strong>{row.name}</strong>
                  </button>
                </td>
                <td>{groupCount(row.id) || "—"}</td>
                <td>{row.notes || "—"}</td>
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
      {selectedId != null && (
        <div className="related-block">
          <p className="eyebrow">Tied groups</p>
          {tiedGroups.length === 0 ? (
            <p className="empty">No groups are assigned to this agent, and no compensation agreements exist.</p>
          ) : (
            <ul className="related-list">
              {tiedGroups.map((group) => {
                const primary = group.primaryAgentId === selectedId;
                const lines = agentAgreements.filter((row) => row.groupId === group.id);
                return (
                  <li key={group.id}>
                    <strong>{group.name}</strong>
                    {primary ? " · primary agent" : ""}
                    {lines.length === 0
                      ? " · no compensation agreement"
                      : lines.map((row) => {
                        const end = row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : "present";
                        return ` · ${row.lineOfBusinessName} ${bpsToPercentString(row.compensationBps)}% ${formatStatementMonth(row.effectiveStart)}–${end}`;
                      }).join("")}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
