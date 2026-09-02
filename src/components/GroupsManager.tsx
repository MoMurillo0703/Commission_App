"use client";

import { FormEvent, useState } from "react";
import type { AccountManager, Agent, Group } from "@/db/schema";

export function GroupsManager({
  initial,
  accountManagers,
  agents,
  selectedId,
  onSelect,
  onGroupsChange,
}: {
  initial: Group[];
  accountManagers: AccountManager[];
  agents: Agent[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onGroupsChange: (rows: Group[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [managers, setManagers] = useState(accountManagers);
  const [agentRows, setAgentRows] = useState(agents);
  const [editing, setEditing] = useState<Group | null>(null);
  const [name, setName] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refreshLookups() {
    const [nextManagers, nextAgents] = await Promise.all([
      fetch("/api/account-managers").then((response) => response.json()),
      fetch("/api/agents").then((response) => response.json()),
    ]);
    setManagers(nextManagers);
    setAgentRows(nextAgents);
  }

  function startEdit(row: Group) {
    setEditing(row);
    onSelect(row.id);
    setName(row.name);
    setGroupNumber(row.groupNumber ?? "");
    setAccountManagerId(row.accountManagerId == null ? "" : String(row.accountManagerId));
    setPrimaryAgentId(row.primaryAgentId == null ? "" : String(row.primaryAgentId));
    setNotes(row.notes ?? "");
    setError("");
  }

  function reset() {
    setEditing(null);
    setName("");
    setGroupNumber("");
    setAccountManagerId("");
    setPrimaryAgentId("");
    setNotes("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(editing ? `/api/groups/${editing.id}` : "/api/groups", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        groupNumber,
        notes,
        accountManagerId: accountManagerId ? Number(accountManagerId) : null,
        primaryAgentId: primaryAgentId ? Number(primaryAgentId) : null,
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save.");
      return;
    }
    const next = await fetch("/api/groups").then((res) => res.json());
    setRows(next);
    onGroupsChange(next);
    onSelect(body.id);
    reset();
  }

  function managerName(id: number | null) {
    return managers.find((manager) => manager.id === id)?.name || "—";
  }

  function agentName(id: number | null) {
    return agentRows.find((agent) => agent.id === id)?.name || "—";
  }

  return (
    <section className="panel">
      <form className="form-grid" onSubmit={save}>
        <label>
          Group name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Group number
          <input value={groupNumber} onChange={(event) => setGroupNumber(event.target.value)} />
        </label>
        <label>
          Account manager
          <select value={accountManagerId} onFocus={() => void refreshLookups()} onChange={(event) => setAccountManagerId(event.target.value)}>
            <option value="">Unassigned</option>
            {managers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Primary agent
          <select value={primaryAgentId} onFocus={() => void refreshLookups()} onChange={(event) => setPrimaryAgentId(event.target.value)}>
            <option value="">Unassigned</option>
            {agentRows.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add group"}</button>
          {editing && (
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="empty">No groups on file yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>Number</th>
              <th>Account manager</th>
              <th>Primary agent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={selectedId === row.id ? "selected-row" : undefined}>
                <td>
                  <button type="button" className="linkish" onClick={() => onSelect(row.id)}>
                    <strong>{row.name}</strong>
                  </button>
                </td>
                <td>{row.groupNumber || "—"}</td>
                <td>{managerName(row.accountManagerId)}</td>
                <td>{agentName(row.primaryAgentId)}</td>
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
