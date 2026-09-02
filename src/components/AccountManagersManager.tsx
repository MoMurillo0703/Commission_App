"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AccountManager, Group } from "@/db/schema";

export function AccountManagersManager({
  initial,
  groups,
}: {
  initial: AccountManager[];
  groups: Group[];
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<AccountManager | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initial[0]?.id ?? null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const assignedGroups = useMemo(
    () => groups.filter((group) => group.accountManagerId === selectedId),
    [groups, selectedId],
  );

  function startEdit(row: AccountManager) {
    setEditing(row);
    setSelectedId(row.id);
    setName(row.name);
    setError("");
  }

  function reset() {
    setEditing(null);
    setName("");
    setError("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch(editing ? `/api/account-managers/${editing.id}` : "/api/account-managers", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save.");
      return;
    }
    const next = await fetch("/api/account-managers").then((res) => res.json());
    setRows(next);
    setSelectedId(body.id);
    reset();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Account managers</p>
          <h2>{editing ? "Edit account manager" : "Account managers"}</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={save}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add account manager"}</button>
          {editing && (
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="empty">No account managers on file yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Groups</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const count = groups.filter((group) => group.accountManagerId === row.id).length;
              return (
                <tr key={row.id} className={selectedId === row.id ? "selected-row" : undefined}>
                  <td>
                    <button type="button" className="linkish" onClick={() => setSelectedId(row.id)}>
                      <strong>{row.name}</strong>
                    </button>
                  </td>
                  <td>{count === 0 ? "—" : `${count} ${count === 1 ? "group" : "groups"}`}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => startEdit(row)}>
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {selectedId != null && (
        <div className="related-block">
          <p className="eyebrow">Assigned groups</p>
          {assignedGroups.length === 0 ? (
            <p className="empty">No groups are assigned to this account manager.</p>
          ) : (
            <ul className="related-list">
              {assignedGroups.map((group) => (
                <li key={group.id}>
                  {group.name}
                  {group.groupNumber ? ` · ${group.groupNumber}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
