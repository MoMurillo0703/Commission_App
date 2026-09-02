"use client";

import { FormEvent, useState } from "react";

type Named = { id: number; name: string };

export function NameEntityManager({
  eyebrow,
  title,
  addLabel,
  empty,
  initial,
  endpoint,
}: {
  eyebrow: string;
  title: string;
  addLabel: string;
  empty: string;
  initial: Named[];
  endpoint: string;
}) {
  const [rows, setRows] = useState(initial);
  const [editing, setEditing] = useState<Named | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function startEdit(row: Named) {
    setEditing(row);
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
    const response = await fetch(editing ? `${endpoint}/${editing.id}` : endpoint, {
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
    const next = await fetch(endpoint).then((res) => res.json());
    setRows(next);
    reset();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{editing ? `Edit ${title.toLowerCase()}` : title}</h2>
        </div>
      </div>
      <form className="form-grid" onSubmit={save}>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : addLabel}</button>
          {editing && (
            <button type="button" className="secondary" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </form>
      {rows.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <strong>{row.name}</strong>
                </td>
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
