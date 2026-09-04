"use client";

import { FormEvent, useState } from "react";
import { AllocationRecipientEditor } from "@/components/AllocationRecipientEditor";
import type { AllocationView } from "@/data/allocations";
import type { CompensationQueueItem } from "@/domain/compensationQueue";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Group, LineOfBusiness } from "@/db/schema";
import {
  allocationEntryPayload,
  cancelAllocationDraft,
  defaultAllocationDraft,
  draftFromAllocationEntries,
  personRoleLabel,
} from "@/domain/allocationEditor";
import { allocationProgressLabel, allocationTotals } from "@/domain/allocations";
import {
  afterSaveQueue,
  closeQueue,
  queueBannerLabel,
  skipQueueIndex,
} from "@/domain/compensationQueue";
import { linesForGroupSelection, type GroupLineEvidence } from "@/domain/activeGroupLines";
import { formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString, parsePercentToBps } from "@/domain/money";

export function CompensationWorkspace({
  groups,
  agents,
  accountManagers,
  linesOfBusiness,
  initialAllocations,
  initialTeams,
  initialQueue = [],
  groupLineEvidence = [],
}: {
  groups: Group[];
  agents: Agent[];
  accountManagers: AccountManager[];
  linesOfBusiness: LineOfBusiness[];
  initialAllocations: AllocationView[];
  initialTeams: TeamView[];
  initialQueue?: CompensationQueueItem[];
  groupLineEvidence?: GroupLineEvidence[];
}) {
  const [allocations, setAllocations] = useState(initialAllocations);
  const [teams, setTeams] = useState(initialTeams);
  const [draft, setDraft] = useState(defaultAllocationDraft());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState<Array<{ personKind: "agent" | "account_manager"; personId: string; percent: string }>>([{ personKind: "agent", personId: "", percent: "" }]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueDone, setQueueDone] = useState(false);
  const [queue, setQueue] = useState(initialQueue);

  const currentQueueItem = queue[queueIndex] ?? null;
  const selectedGroupId = Number(draft.groupId) || null;
  const visibleLines = linesForGroupSelection(
    selectedGroupId,
    linesOfBusiness,
    groupLineEvidence,
    currentQueueItem && currentQueueItem.groupId === selectedGroupId ? [currentQueueItem.lineOfBusinessId] : [],
  );

  const totals = allocationTotals(draft.entries.flatMap((entry) => {
    try {
      return [{ compensationBps: parsePercentToBps(entry.percent || "0") }];
    } catch {
      return [];
    }
  }));

  async function refresh() {
    const [nextAllocations, nextTeams, nextQueue] = await Promise.all([
      fetch("/api/allocations").then((response) => response.json()),
      fetch("/api/teams").then((response) => response.json()),
      fetch("/api/allocations/queue").then((response) => response.json()),
    ]);
    setAllocations(nextAllocations);
    setTeams(nextTeams);
    setQueue(nextQueue);
    return { allocations: nextAllocations as AllocationView[], queue: nextQueue as CompensationQueueItem[] };
  }

  function resetDraft() {
    setDraft(cancelAllocationDraft());
    setError("");
  }

  async function saveAllocation(event?: FormEvent, advanceQueue = false) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/allocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: Number(draft.groupId),
        lineOfBusinessId: Number(draft.lineOfBusinessId),
        effectiveStart: draft.effectiveStart,
        effectiveEnd: draft.effectiveEnd,
        status: "active",
        entries: allocationEntryPayload(draft.entries),
      }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save allocation.");
      return false;
    }
    const refreshed = await refresh();
    if (advanceQueue && currentQueueItem) {
      const remaining = refreshed.queue;
      const advanced = afterSaveQueue(remaining, Math.min(queueIndex, remaining.length), currentQueueItem.key);
      setQueueIndex(advanced.index);
      setQueueDone(advanced.done);
      if (advanced.done) {
        setQueueOpen(false);
        resetDraft();
      } else {
        loadQueueItem(advanced.items[advanced.index] ?? remaining[advanced.index] ?? null);
      }
    } else {
      resetDraft();
    }
    return true;
  }

  function loadQueueItem(item: typeof currentQueueItem) {
    if (!item) return;
    setDraft({
      groupId: String(item.groupId),
      lineOfBusinessId: String(item.lineOfBusinessId),
      effectiveStart: item.suggestedEffectiveStart,
      effectiveEnd: "",
      entries: draftFromAllocationEntries([{
        recipientType: "person",
        personKind: "agent",
        personId: null,
        compensationPercent: "",
      }]),
    });
    setError("");
  }

  function openQueue() {
    setQueueOpen(true);
    setQueueDone(false);
    setQueueIndex(0);
    loadQueueItem(queue[0] ?? null);
  }

  function skipCurrent() {
    const next = skipQueueIndex(queueIndex, queue.length);
    setQueueIndex(next.index);
    setQueueDone(next.done);
    if (next.done) {
      setQueueOpen(false);
      resetDraft();
      return;
    }
    loadQueueItem(queue[next.index] ?? null);
  }

  async function changeAllocation(row: AllocationView) {
    setDraft({
      groupId: String(row.groupId),
      lineOfBusinessId: String(row.lineOfBusinessId),
      effectiveStart: "",
      effectiveEnd: "",
      entries: draftFromAllocationEntries(row.entries.map((entry) => ({
        recipientType: entry.recipientType,
        personKind: entry.personKind,
        personId: entry.personId,
        teamId: entry.teamId,
        compensationPercent: bpsToPercentString(entry.compensationBps),
      }))),
    });
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
    const start = draft.effectiveStart || new Date().toISOString().slice(0, 7);
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
    if (draft.groupId && row.groupId !== Number(draft.groupId)) return false;
    if (!needle) return true;
    return [row.groupName, row.lineOfBusinessName, ...row.entries.map((entry) => entry.personName ?? entry.teamName ?? "Agency")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

  const editor = (
    <AllocationRecipientEditor
      entries={draft.entries}
      agents={agents}
      accountManagers={accountManagers}
      teams={teams}
      onChange={(entries) => setDraft((current) => ({ ...current, entries }))}
    />
  );

  return (
    <>
      {queue.length > 0 && (
        <section className="panel queue-banner">
          <div>
            <p className="eyebrow">Needs attention</p>
            <h2>{queueBannerLabel(queue)}</h2>
            <p>{queue.length} group + line combination{queue.length === 1 ? "" : "s"} {queue.length === 1 ? "is" : "are"} missing a valid active 100% allocation.</p>
          </div>
          <button type="button" onClick={openQueue}>Review groups needing allocation</button>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Complete allocation</p>
            <h2>Group + line of business</h2>
            <p>Every active allocation must total exactly 100%. Agency is a first-class recipient. Posted commissions keep the snapshot used at posting.</p>
          </div>
        </div>
        <form className="form-grid form-grid-wide" onSubmit={(event) => void saveAllocation(event)}>
          <label>
            Group
            <select
              value={draft.groupId}
              onChange={(event) => {
                const groupId = event.target.value;
                const nextLines = linesForGroupSelection(
                  Number(groupId) || null,
                  linesOfBusiness,
                  groupLineEvidence,
                  currentQueueItem && currentQueueItem.groupId === Number(groupId) ? [currentQueueItem.lineOfBusinessId] : [],
                );
                setDraft((current) => ({
                  ...current,
                  groupId,
                  lineOfBusinessId: nextLines.some((line) => String(line.id) === current.lineOfBusinessId)
                    ? current.lineOfBusinessId
                    : "",
                }));
              }}
              required
            >
              <option value="">Select group</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>
            Line of business
            <select value={draft.lineOfBusinessId} onChange={(event) => setDraft((current) => ({ ...current, lineOfBusinessId: event.target.value }))} required disabled={!draft.groupId}>
              <option value="">{draft.groupId ? "Select line" : "Select a group first"}</option>
              {visibleLines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
          <label>
            Effective start
            <input type="month" value={draft.effectiveStart} onChange={(event) => setDraft((current) => ({ ...current, effectiveStart: event.target.value }))} required />
          </label>
          <label>
            Effective end
            <input type="month" value={draft.effectiveEnd} onChange={(event) => setDraft((current) => ({ ...current, effectiveEnd: event.target.value }))} />
          </label>
          {draft.groupId && visibleLines.length === 0 && (
            <p className="muted-note full">This group does not yet have an active line of coverage on file from commissions, allocations, or agreements. Historical inactive lines stay in history and are not listed here.</p>
          )}
          {draft.groupId && visibleLines.length > 0 && (
            <p className="muted-note full">Only lines of business evidenced for this group are listed. Historical inactive lines remain preserved in history.</p>
          )}
          {editor}
          <p className={totals.complete ? "form-success full" : "allocation-progress full"}>{allocationProgressLabel(draft.entries.flatMap((entry) => {
            try { return [{ compensationBps: parsePercentToBps(entry.percent || "0") }]; } catch { return []; }
          }))}</p>
          {error && !queueOpen && <p className="form-error">{error}</p>}
          <div className="form-actions full">
            <button disabled={busy || !totals.complete}>{busy ? "Saving…" : "Save allocation"}</button>
            <button type="button" className="secondary" onClick={resetDraft}>Cancel</button>
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
                  <th>Role</th>
                  <th>Split</th>
                </tr>
              </thead>
              <tbody>
                {row.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.personName ?? entry.teamName ?? "Agency"}</td>
                    <td>{entry.recipientType === "agency" ? "Agency" : entry.recipientType === "team" ? "Team" : personRoleLabel(entry.personKind)}</td>
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
              Member {index + 1} role
              <select value={member.personKind} onChange={(event) => {
                const personKind = event.target.value === "account_manager" ? "account_manager" as const : "agent" as const;
                setTeamMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, personKind, personId: "" } : item));
              }}>
                <option value="agent">Agent</option>
                <option value="account_manager">Account manager</option>
              </select>
              <select value={member.personId} onChange={(event) => setTeamMembers((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, personId: event.target.value } : item))}>
                <option value="">Select {personRoleLabel(member.personKind).toLowerCase()}</option>
                {(member.personKind === "account_manager" ? accountManagers : agents).map((person) => (
                  <option key={person.id} value={person.id}>{person.name} · {personRoleLabel(member.personKind)}</option>
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
                  <th>Role</th>
                  <th>Team %</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.personName}</td>
                    <td>{personRoleLabel(member.personKind)}</td>
                    <td>{bpsToPercentString(member.shareBps)}%</td>
                    <td>{formatStatementMonth(member.effectiveStart)} – {member.effectiveEnd ? formatStatementMonth(member.effectiveEnd) : "Present"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      {queueOpen && currentQueueItem && !queueDone && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="queue-title">
          <div className="modal">
            <p className="eyebrow">Compensation work queue</p>
            <h2 id="queue-title">{currentQueueItem.groupName}</h2>
            <p>{currentQueueItem.lineOfBusinessName} · {currentQueueItem.reasonLabel} · {queueIndex + 1} of {queue.length}</p>
            <form className="form-grid form-grid-wide" onSubmit={(event) => void saveAllocation(event, true)}>
              <label>
                Group
                <input value={currentQueueItem.groupName} readOnly />
              </label>
              <label>
                Line of business
                <input value={currentQueueItem.lineOfBusinessName} readOnly />
              </label>
              <label>
                Effective start
                <input type="month" value={draft.effectiveStart} onChange={(event) => setDraft((current) => ({ ...current, effectiveStart: event.target.value }))} required />
              </label>
              <label>
                Effective end
                <input type="month" value={draft.effectiveEnd} onChange={(event) => setDraft((current) => ({ ...current, effectiveEnd: event.target.value }))} />
              </label>
              {editor}
              <p className={totals.complete ? "form-success full" : "allocation-progress full"}>{allocationProgressLabel(draft.entries.flatMap((entry) => {
                try { return [{ compensationBps: parsePercentToBps(entry.percent || "0") }]; } catch { return []; }
              }))}</p>
              {error && <p className="form-error">{error}</p>}
              <div className="form-actions full">
                <button disabled={busy || !totals.complete}>{busy ? "Saving…" : "Save & Next"}</button>
                <button type="button" className="secondary" onClick={skipCurrent}>Skip for now</button>
                <button type="button" className="secondary" onClick={() => { setQueueOpen(closeQueue().open); resetDraft(); }}>Close</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
