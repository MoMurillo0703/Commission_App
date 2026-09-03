"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { AccountManager, Agent, Group } from "@/db/schema";
import { buildPeopleDirectory, filterPeopleDirectory, personRoleLabel } from "@/domain/peopleDirectory";
import { AccountManagersManager } from "./AccountManagersManager";
import { AgentsManager } from "./AgentsManager";

export function PeopleWorkspace({
  agents,
  accountManagers,
  groups,
  agreements,
}: {
  agents: Agent[];
  accountManagers: AccountManager[];
  groups: Group[];
  agreements: AgreementView[];
}) {
  const [agentRows, setAgentRows] = useState(agents);
  const [managerRows, setManagerRows] = useState(accountManagers);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "agent" | "account_manager">("all");
  const [name, setName] = useState("");
  const [asAgent, setAsAgent] = useState(true);
  const [asManager, setAsManager] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const directory = useMemo(() => {
    const agreementGroupNamesByAgentId = Object.fromEntries(
      agentRows.map((agent) => [
        agent.id,
        [...new Set(agreements.filter((row) => row.agentId === agent.id).map((row) => row.groupName))],
      ]),
    );
    return filterPeopleDirectory(
      buildPeopleDirectory({ agents: agentRows, accountManagers: managerRows, groups, agreementGroupNamesByAgentId }),
      query,
      role,
    );
  }, [agentRows, agreements, groups, managerRows, query, role]);

  async function refresh() {
    const [nextAgents, nextManagers] = await Promise.all([
      fetch("/api/agents").then((response) => response.json()),
      fetch("/api/account-managers").then((response) => response.json()),
    ]);
    setAgentRows(nextAgents);
    setManagerRows(nextManagers);
  }

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
      const body = await response.json();
      if (!response.ok) {
        setBusy(false);
        setError(body.message ?? "Unable to save the agent role.");
        return;
      }
    }
    if (asManager) {
      const response = await fetch("/api/account-managers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) {
        setBusy(false);
        setError(body.message ?? "Unable to save the account manager role.");
        return;
      }
    }
    await refresh();
    setName("");
    setBusy(false);
  }

  return (
    <>
      <section className="panel">
        <p>Agent and account-manager roles are maintained independently. Matching names are not assumed to be the same person. Account manager assignment does not pay anyone.</p>
        <form className="form-grid" onSubmit={addPerson}>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <div className="role-toggles">
            <label><input type="checkbox" checked={asAgent} onChange={(event) => setAsAgent(event.target.checked)} /> Agent</label>
            <label><input type="checkbox" checked={asManager} onChange={(event) => setAsManager(event.target.checked)} /> Account manager</label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button disabled={busy}>{busy ? "Saving…" : "Add person"}</button>
          </div>
        </form>
        <div className="directory-controls">
          <input aria-label="Search people" placeholder="Search people or groups" value={query} onChange={(event) => setQuery(event.target.value)} />
          <select aria-label="Filter by role" value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
            <option value="all">All roles</option>
            <option value="agent">Agents</option>
            <option value="account_manager">Account managers</option>
          </select>
        </div>
        {directory.length === 0 ? (
          <p className="empty">No people match this search.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Groups</th>
              </tr>
            </thead>
            <tbody>
              {directory.map((person) => (
                <tr key={person.key}>
                  <td><strong>{person.name}</strong></td>
                  <td>{personRoleLabel(person.roles)}</td>
                  <td>{person.groupNames.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="grid recent">
        <AgentsManager initial={agentRows} groups={groups} agreements={agreements} />
        <AccountManagersManager initial={managerRows} groups={groups} />
      </div>
    </>
  );
}
