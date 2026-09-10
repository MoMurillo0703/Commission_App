"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import type { PersonDirectoryEntry } from "@/domain/peopleDirectory";
import { filterPeopleDirectory } from "@/domain/peopleDirectory";

export function PeopleDirectory({ people }: { people: PersonDirectoryEntry[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "agent" | "account_manager">("all");
  const [name, setName] = useState("");
  const [asAgent, setAsAgent] = useState(true);
  const [asManager, setAsManager] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const visible = useMemo(() => filterPeopleDirectory(people, query, role), [people, query, role]);

  async function addPerson(event: FormEvent) {
    event.preventDefault();
    if (!asAgent && !asManager) {
      setError("Choose Agent, Account manager, or both.");
      return;
    }
    setBusy(true);
    setError("");
    const payload = { name };
    if (asAgent) {
      const response = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { message?: string };
      if (!response.ok) {
        setBusy(false);
        setError(body.message ?? "Unable to save the agent role.");
        return;
      }
    }
    if (asManager) {
      const response = await fetch("/api/account-managers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json() as { message?: string };
      if (!response.ok) {
        setBusy(false);
        setError(body.message ?? "Unable to save the account manager role.");
        return;
      }
    }
    window.location.reload();
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Account management</p>
          <h2>People</h2>
          <p>Agent and Account Manager are separate identities. Matching names are not the same person. Assignment is not compensation.</p>
        </div>
      </div>
      <div className="directory-toolbar">
        <label>
          Search
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name" />
        </label>
        <label>
          Role
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="all">All roles</option>
            <option value="agent">Agents</option>
            <option value="account_manager">Account managers</option>
          </select>
        </label>
      </div>
      <p className="muted-note">{visible.length} of {people.length} people</p>
      <table className="directory-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Primary Agent groups</th>
            <th>Account Manager groups</th>
            <th>Active teams</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((person) => (
            <tr key={person.key}>
              <td><Link href={person.href}><strong>{person.name}</strong></Link></td>
              <td>{person.roles.includes("account_manager") ? "Account manager" : "Agent"}</td>
              <td>{person.primaryAgentGroupCount}</td>
              <td>{person.accountManagerGroupCount}</td>
              <td>{person.activeTeamCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="form-grid" onSubmit={addPerson} style={{ marginTop: 28 }}>
        <p><strong>Add a person</strong></p>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <div className="role-toggles">
          <label><input type="checkbox" checked={asAgent} onChange={(event) => setAsAgent(event.target.checked)} /> Agent</label>
          <label><input type="checkbox" checked={asManager} onChange={(event) => setAsManager(event.target.checked)} /> Account manager</label>
        </div>
        <div className="form-actions">
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Add person"}</button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
      </form>
    </section>
  );
}
