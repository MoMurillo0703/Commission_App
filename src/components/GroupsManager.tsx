"use client";

import { FormEvent, useState } from "react";
import type { AccountManager, Agent, Group } from "@/db/schema";
import { groupEditDraftFrom, groupEditTitle, type GroupEditDraft } from "@/domain/groupEdit";

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
  onSelect?: (id: number) => void;
  onGroupsChange?: (rows: Group[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  const [managers, setManagers] = useState(accountManagers);
  const [agentRows, setAgentRows] = useState(agents);
  const [editing, setEditing] = useState<GroupEditDraft | null>(null);
  const [name, setName] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkManagerId, setBulkManagerId] = useState("");
  const [bulkAgentId, setBulkAgentId] = useState("");
  const [confirmingBulk, setConfirmingBulk] = useState(false);

  async function refreshLookups() {
    const [nextManagers, nextAgents] = await Promise.all([
      fetch("/api/account-managers").then((response) => response.json()),
      fetch("/api/agents").then((response) => response.json()),
    ]);
    setManagers(nextManagers);
    setAgentRows(nextAgents);
  }

  function startEdit(row: Group) {
    setEditing(groupEditDraftFrom(row));
    onSelect?.(row.id);
    setError("");
  }

  function cancelEdit() {
    setEditing(null);
    setError("");
  }

  function resetCreate() {
    setName("");
    setGroupNumber("");
    setAccountManagerId("");
    setPrimaryAgentId("");
    setNotes("");
    setError("");
  }

  async function saveCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/groups", {
      method: "POST",
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
    onGroupsChange?.(next);
    onSelect?.(body.id);
    resetCreate();
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/groups/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        groupNumber: editing.groupNumber,
        notes: editing.notes,
        accountManagerId: editing.accountManagerId ? Number(editing.accountManagerId) : null,
        primaryAgentId: editing.primaryAgentId ? Number(editing.primaryAgentId) : null,
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
    onGroupsChange?.(next);
    onSelect?.(editing.id);
    cancelEdit();
  }

  function managerName(id: number | null) {
    return managers.find((manager) => manager.id === id)?.name || "—";
  }

  function agentName(id: number | null) {
    return agentRows.find((agent) => agent.id === id)?.name || "—";
  }

  const visible = rows.filter((row) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const manager = managers.find((item) => item.id === row.accountManagerId)?.name || "—";
    const agent = agentRows.find((item) => item.id === row.primaryAgentId)?.name || "—";
    return [row.name, row.groupNumber ?? "", manager, agent].join(" ").toLowerCase().includes(needle);
  });

  const visibleIds = visible.map((row) => row.id);
  const selectedVisible = selectedIds.filter((id) => visibleIds.includes(id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  function toggleOne(id: number) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleAllVisible() {
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      return [...new Set([...current, ...visibleIds])];
    });
  }

  async function applyBulk() {
    if (!confirmingBulk) {
      setConfirmingBulk(true);
      return;
    }
    setBusy(true);
    setError("");
    const payload: Record<string, unknown> = { groupIds: selectedVisible };
    if (bulkManagerId !== "") payload.accountManagerId = bulkManagerId === "unassigned" ? null : Number(bulkManagerId);
    if (bulkAgentId !== "") payload.primaryAgentId = bulkAgentId === "unassigned" ? null : Number(bulkAgentId);
    const response = await fetch("/api/groups/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to apply bulk assignment.");
      setConfirmingBulk(false);
      return;
    }
    const next = await fetch("/api/groups").then((res) => res.json());
    setRows(next);
    onGroupsChange?.(next);
    setSelectedIds([]);
    setBulkManagerId("");
    setBulkAgentId("");
    setConfirmingBulk(false);
  }

  return (
    <section className="panel">
      <form className="form-grid" onSubmit={saveCreate}>
        <p className="eyebrow">Add group</p>
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
              <option key={manager.id} value={manager.id}>{manager.name}</option>
            ))}
          </select>
        </label>
        <label>
          Primary agent
          <select value={primaryAgentId} onFocus={() => void refreshLookups()} onChange={(event) => setPrimaryAgentId(event.target.value)}>
            <option value="">Unassigned</option>
            {agentRows.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
        </label>
        {!editing && error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy || Boolean(editing)}>{busy && !editing ? "Saving…" : "Add group"}</button>
        </div>
      </form>

      {editing && (
        <div className="edit-panel" role="dialog" aria-labelledby="edit-group-title">
          <p className="eyebrow">Edit group</p>
          <h2 id="edit-group-title">{groupEditTitle(editing.name || "Group")}</h2>
          <p>Saving updates this group only. Assignment changes do not change compensation or posted commissions.</p>
          <form className="form-grid" onSubmit={saveEdit}>
            <label>
              Group name
              <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required />
            </label>
            <label>
              Group number
              <input value={editing.groupNumber} onChange={(event) => setEditing({ ...editing, groupNumber: event.target.value })} />
            </label>
            <label>
              Account manager
              <select value={editing.accountManagerId} onFocus={() => void refreshLookups()} onChange={(event) => setEditing({ ...editing, accountManagerId: event.target.value })}>
                <option value="">Unassigned</option>
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>{manager.name}</option>
                ))}
              </select>
            </label>
            <label>
              Primary agent
              <select value={editing.primaryAgentId} onFocus={() => void refreshLookups()} onChange={(event) => setEditing({ ...editing, primaryAgentId: event.target.value })}>
                <option value="">Unassigned</option>
                {agentRows.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
            </label>
            <label>
              Notes
              <textarea value={editing.notes} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} rows={3} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <button disabled={busy}>{busy ? "Saving…" : "Save Changes"}</button>
              <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <label className="directory-controls">
        <input aria-label="Search groups" placeholder="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>

      {selectedVisible.length > 0 && (
        <div className="bulk-bar">
          <strong>{selectedVisible.length} group{selectedVisible.length === 1 ? "" : "s"} selected</strong>
          <label>
            Assign Account Manager
            <select value={bulkManagerId} onChange={(event) => { setBulkManagerId(event.target.value); setConfirmingBulk(false); }} onFocus={() => void refreshLookups()}>
              <option value="">No change</option>
              <option value="unassigned">Unassigned</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.name}</option>
              ))}
            </select>
          </label>
          <label>
            Assign Primary Agent
            <select value={bulkAgentId} onChange={(event) => { setBulkAgentId(event.target.value); setConfirmingBulk(false); }} onFocus={() => void refreshLookups()}>
              <option value="">No change</option>
              <option value="unassigned">Unassigned</option>
              {agentRows.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="button" disabled={busy || (bulkManagerId === "" && bulkAgentId === "")} onClick={() => void applyBulk()}>
              {confirmingBulk ? "Confirm apply" : "Apply"}
            </button>
            {confirmingBulk && (
              <button type="button" className="secondary" onClick={() => setConfirmingBulk(false)}>Cancel</button>
            )}
          </div>
          {confirmingBulk && (
            <p>This updates account manager and/or primary agent on the selected groups. It does not create or change compensation.</p>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="empty">No groups on file yet.</p>
      ) : visible.length === 0 ? (
        <p className="empty">No groups match this search.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>
                <label>
                  <input
                    type="checkbox"
                    aria-label="Select all groups in current results"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                  />
                  Select all
                </label>
              </th>
              <th>Group</th>
              <th>Number</th>
              <th>Account manager</th>
              <th>Primary agent</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id} className={selectedId === row.id || editing?.id === row.id ? "selected-row" : undefined}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.name}`}
                    checked={selectedIds.includes(row.id)}
                    onChange={() => toggleOne(row.id)}
                  />
                </td>
                <td>
                  <button type="button" className="linkish" onClick={() => onSelect?.(row.id)}>
                    <strong>{row.name}</strong>
                  </button>
                </td>
                <td>{row.groupNumber || "—"}</td>
                <td>{managerName(row.accountManagerId)}</td>
                <td>{agentName(row.primaryAgentId)}</td>
                <td>
                  <button type="button" className="secondary" onClick={() => startEdit(row)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
