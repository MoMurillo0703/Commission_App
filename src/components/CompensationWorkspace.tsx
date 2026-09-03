"use client";

import { FormEvent, useMemo, useState } from "react";
import type { AllocationView } from "@/data/allocations";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Group, LineOfBusiness } from "@/db/schema";
import { allocationProgressLabel, allocationTotals } from "@/domain/allocations";
import { formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString, parsePercentToBps } from "@/domain/money";

type DraftEntry = {
  recipientType: "agency" | "person" | "team";
  personKind: "agent" | "account_manager" | "";
  personId: string;
  teamId: string;
  percent: string;
};

const emptyEntry = (): DraftEntry => ({ recipientType: "person", personKind: "agent", personId: "", teamId: "", percent: "" });

export function CompensationWorkspace({
  groups,
  agents,
  accountManagers,
  linesOfBusiness,
  initialAllocations,
  initialTeams,
}: {
  groups: Group[];
  agents: Agent[];
  accountManagers: AccountManager[];
  linesOfBusiness: LineOfBusiness[];
  initialAllocations: AllocationView[];
  initialTeams: TeamView[];
}) {
  const [allocations, setAllocations] = useState(initialAllocations);
  const [teams, setTeams] = useState(initialTeams);
  const [groupId, setGroupId] = useState("");
  const [lineOfBusinessId, setLineOfBusinessId] = useState("");
  const [effectiveStart, setEffectiveStart] = useState("");
  const [effectiveEnd, setEffectiveEnd] = useState("");
  const [entries, setEntries] = useState<DraftEntry[]>([emptyEntry()]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState([{ personKind: "agent", personId: "", percent: "" }]);

  const people = useMemo(() => [
    ...agents.map((agent) => ({ key: `agent:${agent.id}`, personKind: "agent" as const, personId: agent.id, name: agent.name, type: "Person" })),
    ...accountManagers.map((manager) => ({ key: `account_manager:${manager.id}`, personKind: "account_manager" as const, personId: manager.id, name: manager.name, type: "Person" })),
  ].sort((left, right) => left.name.localeCompare(right.name)), [accountManagers, agents]);

  const totals = allocationTotals(entries.flatMap((entry) => {
    try {
      return [{ compensationBps: parsePercentToBps(entry.percent || "0") }];
    } catch {
      return [];
    }
  }));

  async function refresh() {
    const [nextAllocations, nextTeams] = await Promise.all([
      fetch("/api/allocations").then((response) => response.json()),
      fetch("/api/teams").then((response) => response.json()),
    ]);
    setAllocations(nextAllocations);
    setTeams(nextTeams);
  }

  function addEntry(type: DraftEntry["recipientType"]) {
    setEntries((current) => [...current, { ...emptyEntry(), recipientType: type, personKind: type === "person" ? "agent" : "" }]);
  }

  async function saveAllocation(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: Number(groupId),
        lineOfBusinessId: Number(lineOfBusinessId),
        effectiveStart,
        effectiveEnd,
        status: "active",
        entries: entries.map((entry) => ({
          recipientType: entry.recipientType,
          personKind: entry.recipientType === "person" ? entry.personKind : null,
          personId: entry.recipientType === "person" && entry.personId ? Number(entry.personId) : null,
          teamId: entry.recipientType === "team" && entry.teamId ? Number(entry.teamId) : null,
          compensationPercent: entry.percent,
        })),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save allocation.");
      return;
    }
    await refresh();
    setEntries([emptyEntry()]);
    setEffectiveEnd("");
  }

  async function changeAllocation(row: AllocationView) {
    setGroupId(String(row.groupId));
    setLineOfBusinessId(String(row.lineOfBusinessId));
    setEffectiveStart("");
    setEffectiveEnd("");
    setEntries(row.entries.map((entry) => ({
      recipientType: entry.recipientType,
      personKind: entry.personKind ?? "agent",
      personId: entry.personId == null ? "" : String(entry.personId),
      teamId: entry.teamId == null ? "" : String(entry.teamId),
      percent: bpsToPercentString(entry.compensationBps),
    })));
    setError("Enter a new effective start month, then save. The prior allocation will close the month before.");
  }

  async function deactivate(id: number) {
    setBusy(true);
    const response = await fetch(`/api/allocations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "inactive" }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to deactivate.");
      return;
    }
    await refresh();
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const start = effectiveStart || new Date().toISOString().slice(0, 7);
    const response = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: teamName,
        status: "active",
        members: teamMembers.map((member) => ({
          personKind: member.personKind,
          personId: Number(member.personId),
          compensationPercent: member.percent,
          effectiveStart: start,
        })),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save team.");
      return;
    }
    await refresh();
    setTeamName("");
    setTeamMembers([{ personKind: "agent", personId: "", percent: "" }]);
  }

  const visible = allocations.filter((row) => {
    const needle = query.trim().toLowerCase();
    if (groupId && row.groupId !== Number(groupId)) return false;
    if (!needle) return true;
    return [row.groupName, row.lineOfBusinessName, ...row.entries.map((entry) => entry.personName ?? entry.teamName ?? "Agency")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Complete allocation</p>
            <h2>Group + line of business</h2>
            <p>Every active allocation must total exactly 100%. Agency is a first-class recipient. Posted commissions keep the snapshot used at posting.</p>
          </div>
        </div>
        <form className="form-grid form-grid-wide" onSubmit={saveAllocation}>
          <label>
            Group
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required>
              <option value="">Select group</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>
            Line of business
            <select value={lineOfBusinessId} onChange={(event) => setLineOfBusinessId(event.target.value)} required>
              <option value="">Select line</option>
              {linesOfBusiness.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
          <label>
            Effective start
            <input type="month" value={effectiveStart} onChange={(event) => setEffectiveStart(event.target.value)} required />
          </label>
          <label>
            Effective end
            <input type="month" value={effectiveEnd} onChange={(event) => setEffectiveEnd(event.target.value)} />
          </label>
          <div className="full">
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Type</th>
                  <th>Split</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={index}>
                    <td>
                      {entry.recipientType === "agency" && "Murillo Insurance"}
                      {entry.recipientType === "person" && (
                        <select value={entry.personId ? `${entry.personKind}:${entry.personId}` : ""} onChange={(event) => {
                          const [personKind, personId] = event.target.value.split(":");
                          setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? {
                            ...item,
                            personKind: personKind as "agent" | "account_manager",
                            personId,
                          } : item));
                        }}>
                          <option value="">Select person</option>
                          {people.map((person) => (
                            <option key={person.key} value={person.key}>{person.name} · {person.personKind === "agent" ? "Agent" : "Account manager"}</option>
                          ))}
                        </select>
                      )}
                      {entry.recipientType === "team" && (
                        <select value={entry.teamId} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, teamId: event.target.value } : item))}>
                          <option value="">Select team</option>
                          {teams.filter((team) => team.status === "active").map((team) => (
                            <option key={team.id} value={team.id}>{team.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>{entry.recipientType === "agency" ? "Agency" : entry.recipientType === "team" ? "Team" : "Person"}</td>
                    <td>
                      <input value={entry.percent} onChange={(event) => setEntries((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, percent: event.target.value } : item))} placeholder="70" required />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={totals.complete ? "form-success" : "allocation-progress"}>{allocationProgressLabel(entries.flatMap((entry) => {
              try { return [{ compensationBps: parsePercentToBps(entry.percent || "0") }]; } catch { return []; }
            }))}</p>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => addEntry("person")}>Add Person</button>
              <button type="button" className="secondary" onClick={() => addEntry("team")}>Add Team</button>
              <button type="button" className="secondary" onClick={() => addEntry("agency")} disabled={entries.some((entry) => entry.recipientType === "agency")}>Add Agency Share</button>
            </div>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions full">
            <button disabled={busy || !totals.complete}>{busy ? "Saving…" : "Save allocation"}</button>
          </div>
        </form>
        <label className="directory-controls">
          <input aria-label="Search allocations" placeholder="Search allocations" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {visible.length === 0 ? (
          <p className="empty">No allocations yet. Create a complete 100% allocation to start paying recipients.</p>
        ) : visible.map((row) => (
          <article key={row.id} className="allocation-card">
            <h2>{row.groupName}</h2>
            <p>{row.lineOfBusinessName} · {formatStatementMonth(row.effectiveStart)} – {row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : "Present"} · {row.status}</p>
            <table>
              <thead>
                <tr>
                  <th>Recipient</th>
                  <th>Type</th>
                  <th>Split</th>
                </tr>
              </thead>
              <tbody>
                {row.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.personName ?? entry.teamName ?? "Agency"}</td>
                    <td>{entry.recipientType === "agency" ? "Agency" : entry.recipientType === "team" ? "Team" : "Person"}</td>
                    <td>{bpsToPercentString(entry.compensationBps)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={allocationTotals(row.entries).complete ? "form-success" : "allocation-progress"}>{allocationProgressLabel(row.entries)}</p>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => void changeAllocation(row)}>Change Allocation</button>
              {row.status === "active" && <button type="button" className="secondary" onClick={() => void deactivate(row.id)}>Deactivate</button>}
            </div>
          </article>
        ))}
      </section>

      <section className="panel recent">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Reusable teams</p>
            <h2>Teams</h2>
            <p>Team member splits must total 100%. Changing a team later does not rewrite posted commissions.</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={saveTeam}>
          <label>
            Team name
            <input value={teamName} onChange={(event) => setTeamName(event.target.value)} required />
          </label>
          {teamMembers.map((member, index) => (
            <label key={index}>
              Member {index + 1}
              <select value={`${member.personKind}:${member.personId}`} onChange={(event) => {
                const [personKind, personId] = event.target.value.split(":");
                setTeamMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, personKind, personId } : item));
              }}>
                <option value="agent:">Select person</option>
                {people.map((person) => (
                  <option key={person.key} value={`${person.personKind}:${person.personId}`}>{person.name}</option>
                ))}
              </select>
              <input value={member.percent} onChange={(event) => setTeamMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, percent: event.target.value } : item))} placeholder="50" />
            </label>
          ))}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setTeamMembers((current) => [...current, { personKind: "agent", personId: "", percent: "" }])}>Add member</button>
            <button disabled={busy}>{busy ? "Saving…" : "Save team"}</button>
          </div>
        </form>
        {teams.map((team) => (
          <article key={team.id} className="allocation-card">
            <h2>{team.name}</h2>
            <p>{team.status}</p>
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Team %</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.personName}</td>
                    <td>{bpsToPercentString(member.shareBps)}%</td>
                    <td>{formatStatementMonth(member.effectiveStart)} – {member.effectiveEnd ? formatStatementMonth(member.effectiveEnd) : "Present"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>
    </>
  );
}
