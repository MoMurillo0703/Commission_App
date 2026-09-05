"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { AllocationView } from "@/data/allocations";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Group } from "@/db/schema";
import { bpsToPercentString } from "@/domain/money";
import { editAllocationHref, personCompensationPeriod, personCompensationRows } from "@/domain/personCompensation";
import { buildPeopleDirectory, filterPeopleDirectory, personRoleLabel } from "@/domain/peopleDirectory";
import { AccountManagersManager } from "./AccountManagersManager";
import { AgentsManager } from "./AgentsManager";

export function PeopleWorkspace({
  agents,
  accountManagers,
  groups,
  agreements,
  allocations = [],
  teams = [],
}: {
  agents: Agent[];
  accountManagers: AccountManager[];
  groups: Group[];
  agreements: AgreementView[];
  allocations?: AllocationView[];
  teams?: TeamView[];
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
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  const selectedPerson = directory.find((person) => person.key === selectedKey) ?? null;
  const selectedKind = selectedPerson?.roles.includes("account_manager") && selectedPerson.accountManagerId
    ? "account_manager" as const
    : "agent" as const;
  const selectedPersonId = selectedKind === "account_manager"
    ? selectedPerson?.accountManagerId
    : selectedPerson?.agentId;
  const selectedSplits = selectedPerson && selectedPersonId
    ? personCompensationRows({
      allocations,
      teams,
      personKind: selectedKind,
      personId: selectedPersonId,
    })
    : [];

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
                <tr key={person.key} className={person.key === selectedKey ? "selected-row" : undefined}>
                  <td>
                    <button type="button" className="linkish" onClick={() => setSelectedKey(person.key)}>
                      <strong>{person.name}</strong>
                    </button>
                  </td>
                  <td>{personRoleLabel(person.roles)}</td>
                  <td>{person.groupNames.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedPerson && (
          <div className="related-block" id="person-compensation">
            <strong>Compensation / splits · {selectedPerson.name}</strong>
            <p>These are existing Group + line of business allocations. Edit opens the complete 100% plan. Changing one person still requires the allocation to total 100%.</p>
            {selectedSplits.length === 0 ? (
              <p className="empty">This person has no compensation allocation rows. Assignment to a group does not create pay.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>LOB</th>
                    <th>Role</th>
                    <th>Split</th>
                    <th>Effective</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedSplits.map((row) => (
                    <tr key={`${row.allocationId}-${row.recipientType}-${row.teamName ?? "direct"}`}>
                      <td>{row.groupName}</td>
                      <td>{row.lineOfBusinessName}</td>
                      <td>{row.roleLabel}{row.teamName ? ` · ${row.teamName}` : ""}</td>
                      <td>{bpsToPercentString(row.allocationBps)}%</td>
                      <td>{personCompensationPeriod(row)}</td>
                      <td>{row.status}</td>
                      <td>
                        <a className="secondary" href={editAllocationHref(row.allocationId)} style={{ display: "inline-block", textDecoration: "none" }}>
                          Edit Allocation
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
      <div className="grid recent">
        <AgentsManager initial={agentRows} groups={groups} agreements={agreements} />
        <AccountManagersManager initial={managerRows} groups={groups} />
      </div>
    </>
  );
}
