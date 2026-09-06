"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AllocationRecipientEditor } from "@/components/AllocationRecipientEditor";
import { GroupCoverageTable } from "@/components/GroupCoverageTable";
import type { AllocationView } from "@/data/allocations";
import {
  afterGroupQueueRefresh,
  closeQueue,
  groupQueueNeedsLabel,
  queueBannerLabel,
  queueSessionProgressLabel,
  skipQueueIndex,
  type GroupCompensationQueueItem,
} from "@/domain/compensationQueue";
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
import { plannedAllocationTargets, type LineApplyMode } from "@/domain/allocationBulkApply";
import {
  clearCoverageModes,
  groupCoverageLines,
  selectNeedingSetupModes,
  setCoverageMode,
} from "@/domain/groupCoverage";
import { bulkAllocationRequestBody } from "@/domain/groupCompensationWorkspace";
import { allocationSavedMessage, runBulkAllocationSaveFlow } from "@/domain/allocationSaveFlow";
import type { AllocationTerms } from "@/domain/allocationTerms";
import {
  compensationGroupSummaries,
  filterCompensationGroups,
  groupActiveCountLabel,
  historicalAllocationsForGroup,
  allocationRecipientSummary,
} from "@/domain/compensationHome";
import { runTeamSaveFlow, teamSavedMessage } from "@/domain/teamSaveFlow";
import type { GroupLineEvidence } from "@/domain/activeGroupLines";
import { formatStatementMonth } from "@/domain/dates";
import { bpsToPercentString, parsePercentToBps } from "@/domain/money";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

export function CompensationWorkspace({
  groups,
  agents,
  accountManagers,
  linesOfBusiness,
  initialAllocations,
  initialTeams,
  initialQueue = [],
  groupLineEvidence = [],
  focusAllocationId = null,
}: {
  groups: Group[];
  agents: Agent[];
  accountManagers: AccountManager[];
  linesOfBusiness: LineOfBusiness[];
  initialAllocations: AllocationView[];
  initialTeams: TeamView[];
  initialQueue?: GroupCompensationQueueItem[];
  groupLineEvidence?: GroupLineEvidence[];
  focusAllocationId?: number | null;
}) {
  const [allocations, setAllocations] = useState(initialAllocations);
  const [teams, setTeams] = useState(initialTeams);
  const [draft, setDraft] = useState(defaultAllocationDraft());
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState<Array<{ personKind: "agent" | "account_manager"; personId: string; percent: string }>>([{ personKind: "agent", personId: "", percent: "" }]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [queueDone, setQueueDone] = useState(false);
  const [queue, setQueue] = useState(initialQueue);
  const [queueNotice, setQueueNotice] = useState("");
  const [queueSessionTotal, setQueueSessionTotal] = useState(initialQueue.length);
  const [queueSessionPosition, setQueueSessionPosition] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [lineModes, setLineModes] = useState<Record<number, LineApplyMode>>({});
  const allocationsRef = useRef(allocations);
  const pendingOverrideLineId = useRef<number | null>(null);
  allocationsRef.current = allocations;

  const currentQueueItem = queue[queueIndex] ?? null;
  const draftGroupId = Number(draft.groupId) || null;
  const totals = allocationTotals(draft.entries.flatMap((entry) => {
    try {
      return [{ compensationBps: parsePercentToBps(entry.percent || "0") }];
    } catch {
      return [];
    }
  }));

  async function refresh(failureMessage = "Allocation saved, but the page could not refresh. Reload Compensation to continue.") {
    const [allocationsResponse, teamsResponse, queueResponse] = await Promise.all([
      fetchWithDeadline("/api/allocations"),
      fetchWithDeadline("/api/teams"),
      fetchWithDeadline("/api/allocations/queue"),
    ]);
    const nextAllocations = await readApiJson<AllocationView[]>(allocationsResponse);
    const nextTeams = await readApiJson<TeamView[]>(teamsResponse);
    const nextQueue = await readApiJson<GroupCompensationQueueItem[]>(queueResponse);
    if (!allocationsResponse.ok || !teamsResponse.ok || !queueResponse.ok) {
      throw new Error(failureMessage);
    }
    allocationsRef.current = nextAllocations;
    setAllocations(nextAllocations);
    setTeams(nextTeams);
    setQueue(nextQueue);
    return { allocations: nextAllocations, queue: nextQueue, teams: nextTeams };
  }

  function resetDraft() {
    setDraft(cancelAllocationDraft());
    setError("");
  }

  async function saveSelectedLines() {
    setError("");
    setSuccess("");
    const targets = plannedAllocationTargets({
      lineIds: applyLines.map((line) => line.lineOfBusinessId),
      modes: lineModes,
      templateEntries: allocationEntryPayload(draft.entries).map((entry) => ({
        recipientType: entry.recipientType,
        personKind: entry.personKind,
        personId: entry.personId,
        teamId: entry.teamId,
        compensationBps: parsePercentToBps(entry.compensationPercent || "0"),
      })),
    });
    if (targets.length === 0) {
      setError("Select at least one line of business to apply this setup.");
      return;
    }
    const submitted: AllocationTerms[] = targets.map((target) => ({
      groupId: Number(draft.groupId),
      lineOfBusinessId: target.lineOfBusinessId,
      effectiveStart: draft.effectiveStart,
      effectiveEnd: draft.effectiveEnd || null,
      status: "active",
      entries: target.entries,
    }));
    try {
      await runBusyAction(setBusy, async () => {
        const result = await runBulkAllocationSaveFlow({
          request: async () => {
            const response = await fetchWithDeadline("/api/allocations/bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(bulkAllocationRequestBody({
                groupId: Number(draft.groupId),
                effectiveStart: draft.effectiveStart,
                effectiveEnd: draft.effectiveEnd,
                targets,
                draftEntries: draft.entries,
              })),
            });
            const body = await readApiJson<{ message?: string }>(response);
            return { ok: response.ok, message: httpFailureMessage(response.status, body.message) };
          },
          refresh,
          submitted,
        });
        setQueue(result.queue);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSuccess(result.success ?? allocationSavedMessage());
        setLineModes({});
        if (queueOpen && currentQueueItem) {
          const next = afterGroupQueueRefresh(result.queue, currentQueueItem.groupId, queueIndex);
          setQueueIndex(next.index);
          setQueueDone(next.done);
          setQueueOpen(!next.done);
          if (next.advance && !next.done) {
            setQueueSessionPosition((position) => position + 1);
            loadQueueGroup(result.queue[next.index] ?? null);
          } else if (next.done) {
            resetDraft();
          }
          return;
        }
        if (!queueOpen) resetDraft();
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to save group compensation."));
    }
  }

  useEffect(() => {
    if (!focusAllocationId) return;
    const row = allocations.find((allocation) => allocation.id === focusAllocationId);
    if (row) {
      setSelectedGroupId(row.groupId);
      changeAllocation(row);
    }
    // Load the complete allocation once when arriving from People.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAllocationId]);

  function loadQueueGroup(item: GroupCompensationQueueItem | null) {
    if (!item) return;
    setSelectedGroupId(item.groupId);
    setDraft({
      groupId: String(item.groupId),
      lineOfBusinessId: "",
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
    setSuccess("");
  }

  function openQueue() {
    setQueueOpen(true);
    setQueueDone(false);
    setQueueIndex(0);
    setQueueNotice("");
    setSuccess("");
    setQueueSessionTotal(queue.length);
    setQueueSessionPosition(0);
    loadQueueGroup(queue[0] ?? null);
  }

  function skipCurrent() {
    setSuccess("");
    setError("");
    setQueueNotice("");
    setQueueSessionPosition((position) => position + 1);
    const next = skipQueueIndex(queueIndex, queue.length);
    setQueueIndex(next.index);
    setQueueDone(next.done);
    if (next.done) {
      setQueueOpen(false);
      resetDraft();
      return;
    }
    loadQueueGroup(queue[next.index] ?? null);
  }

  async function changeAllocation(row: { id: number }) {
    const allocation = allocationsRef.current.find((item) => item.id === row.id);
    if (!allocation) return;
    pendingOverrideLineId.current = allocation.lineOfBusinessId;
    setSelectedGroupId(allocation.groupId);
    setDraft({
      groupId: String(allocation.groupId),
      lineOfBusinessId: String(allocation.lineOfBusinessId),
      effectiveStart: "",
      effectiveEnd: "",
      entries: draftFromAllocationEntries(allocation.entries.map((entry) => ({
        recipientType: entry.recipientType,
        personKind: entry.personKind,
        personId: entry.personId,
        teamId: entry.teamId,
        compensationPercent: bpsToPercentString(entry.compensationBps),
      }))),
    });
    setError("Enter a new effective start month, then apply. Only this Line of Coverage is selected.");
  }

  async function deactivate(id: number) {
    setError("");
    setSuccess("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/allocations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "inactive" }),
        });
        const body = await readApiJson<{ message?: string }>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        await refresh();
        setSuccess("Allocation deactivated.");
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to deactivate."));
    }
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const start = draft.effectiveStart || new Date().toISOString().slice(0, 7);
    try {
      await runBusyAction(setBusy, async () => {
        const result = await runTeamSaveFlow({
          request: async () => {
            const response = await fetchWithDeadline("/api/teams", {
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
            const body = await readApiJson<{ message?: string }>(response);
            return { ok: response.ok, message: httpFailureMessage(response.status, body.message) };
          },
          refresh: async () => refresh("Team saved, but the page could not refresh. Reload Compensation to continue."),
          savedName: teamName,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        setSuccess(result.success ?? teamSavedMessage());
        setTeamName("");
        setTeamMembers([{ personKind: "agent", personId: "", percent: "" }]);
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to save team."));
    }
  }

  const groupSummaries = filterCompensationGroups(compensationGroupSummaries(allocations, groups), query);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedHistory = selectedGroupId ? historicalAllocationsForGroup(allocations, selectedGroupId) : [];
  const coverageLines = groupCoverageLines({
    groupId: selectedGroupId ?? draftGroupId,
    lines: linesOfBusiness,
    evidence: groupLineEvidence,
    allocations,
    keepLineIds: currentQueueItem && (currentQueueItem.groupId === selectedGroupId || currentQueueItem.groupId === draftGroupId)
      ? currentQueueItem.lineOfBusinessIds
      : [],
  });
  const applyLines = coverageLines;
  const templateEntries = draft.entries.flatMap((entry) => {
    try {
      return [{
        recipientType: entry.recipientType,
        personKind: entry.personKind || null,
        personId: entry.personId ? Number(entry.personId) : null,
        teamId: entry.teamId ? Number(entry.teamId) : null,
        compensationBps: parsePercentToBps(entry.percent || "0"),
      }];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (pendingOverrideLineId.current != null) {
      const lineId = pendingOverrideLineId.current;
      pendingOverrideLineId.current = null;
      setLineModes(Object.fromEntries(coverageLines.map((line) => [
        line.lineOfBusinessId,
        line.lineOfBusinessId === lineId ? "template" : "skip",
      ])));
      return;
    }
    setLineModes({});
    // Default selection is unconfigured LOBs via coverageMode fallback. Do not wipe checkbox/agency choices after refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGroupId, selectedGroupId]);

  function beginLineOverride(line: (typeof coverageLines)[number]) {
    const allocation = allocations.find((row) => row.id === line.allocationId);
    setDraft((current) => ({
      ...current,
      groupId: String(selectedGroupId ?? draftGroupId ?? ""),
      lineOfBusinessId: String(line.lineOfBusinessId),
      entries: allocation
        ? draftFromAllocationEntries(allocation.entries.map((entry) => ({
          recipientType: entry.recipientType,
          personKind: entry.personKind,
          personId: entry.personId,
          teamId: entry.teamId,
          compensationPercent: bpsToPercentString(entry.compensationBps),
        })))
        : current.entries,
    }));
    setLineModes(Object.fromEntries(coverageLines.map((item) => [
      item.lineOfBusinessId,
      item.lineOfBusinessId === line.lineOfBusinessId ? "template" : "skip",
    ])));
    setError("Enter a new effective start month, then apply. Only this Line of Coverage is selected.");
    setSuccess("");
  }

  const editor = (
    <AllocationRecipientEditor
      entries={draft.entries}
      agents={agents}
      accountManagers={accountManagers}
      teams={teams}
      onChange={(entries) => setDraft((current) => ({ ...current, entries }))}
    />
  );

  const coverageTable = (
    <GroupCoverageTable
      lines={coverageLines}
      modes={lineModes}
      templateEntries={templateEntries}
      onToggle={(lineOfBusinessId, selected, currentMode) => setLineModes((current) => setCoverageMode(
        current,
        lineOfBusinessId,
        selected ? (currentMode === "agency" ? "agency" : "template") : "skip",
      ))}
      onAgency={(lineOfBusinessId) => setLineModes((current) => setCoverageMode(current, lineOfBusinessId, "agency"))}
      onChange={(line) => beginLineOverride(line)}
      onDeactivate={(allocationId) => void deactivate(allocationId)}
      onSelectNeedingSetup={() => setLineModes(selectNeedingSetupModes(coverageLines))}
      onClearSelection={() => setLineModes(clearCoverageModes(coverageLines))}
    />
  );

  return (
    <>
      {queue.length > 0 && (
        <section className="panel queue-banner">
          <div>
            <p className="eyebrow">Needs attention</p>
            <h2>{queueBannerLabel(queue)}</h2>
            <p>{queue.length} group{queue.length === 1 ? "" : "s"} {queue.length === 1 ? "has" : "have"} Lines of Coverage that still need compensation.</p>
          </div>
          <button type="button" onClick={openQueue}>Review groups needing allocation</button>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Browse by group</p>
            <h2>Compensation</h2>
            <p>Search a group to see every Line of Coverage together. Enter recipients once and apply them to the selected lines. Posted commissions keep their original payout snapshots.</p>
          </div>
        </div>
        <label className="directory-controls">
          <input aria-label="Search groups" placeholder="Search groups" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        {groupSummaries.length === 0 ? (
          <p className="empty">No group allocations match this search. Use the work queue to set up missing compensation.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Current allocations</th>
              </tr>
            </thead>
            <tbody>
              {groupSummaries.map((group) => (
                <tr key={group.groupId} className={group.groupId === selectedGroupId ? "selected-row" : undefined}>
                  <td>
                    <button type="button" className="linkish" onClick={() => {
                      setSelectedGroupId(group.groupId);
                      setShowHistory(false);
                      setDraft((current) => ({ ...current, groupId: String(group.groupId), lineOfBusinessId: "" }));
                    }}>
                      <strong>{group.groupName}</strong>
                    </button>
                  </td>
                  <td>{groupActiveCountLabel(group.activeAllocationCount)}{group.currentLineNames.length ? ` · ${group.currentLineNames.join(", ")}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {selectedGroup && (
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Group compensation</p>
            <h2>{selectedGroup.name}</h2>
            <p>Enter recipients once, select the Lines of Coverage that should use this setup, then apply. Already-configured lines stay unchanged unless you intentionally select them. Posted payout snapshots are not rewritten.</p>
          </div>
        </div>
        <h3>Lines of Coverage</h3>
        {coverageTable}
        <div className="related-block">
          <button type="button" className="secondary" onClick={() => setShowHistory((current) => !current)}>
            {showHistory ? "Hide history" : "Show historical allocations"}
          </button>
          {showHistory && (selectedHistory.length === 0 ? (
            <p className="empty">No historical allocations for this group.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>LOB</th>
                  <th>Recipients</th>
                  <th>Effective</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistory.map((row) => (
                  <tr key={row.id} className="history-row">
                    <td>{row.lineOfBusinessName}</td>
                    <td>{allocationRecipientSummary(row)}</td>
                    <td>{formatStatementMonth(row.effectiveStart)} – {row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : "Present"}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
        <form className="form-grid form-grid-wide" onSubmit={(event) => { event.preventDefault(); void saveSelectedLines(); }}>
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
          {error && !queueOpen && <p className="form-error">{error}</p>}
          {success && !queueOpen && <p className="form-success">{success}</p>}
          <div className="form-actions full">
            <button type="submit" disabled={busy || !totals.complete || coverageLines.length === 0}>
              {busy ? "Saving…" : "Apply to Selected Lines"}
            </button>
            <button type="button" className="secondary" onClick={resetDraft}>Cancel</button>
          </div>
        </form>
      </section>
      )}

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
          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}
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
            <p>{groupQueueNeedsLabel(currentQueueItem.needingLineCount)} · {queueSessionProgressLabel(queueSessionPosition, queueSessionTotal || queue.length)}</p>
            {coverageTable}
            <form className="form-grid form-grid-wide" onSubmit={(event) => { event.preventDefault(); void saveSelectedLines(); }}>
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
              {queueNotice && <p className="muted-note">{queueNotice}</p>}
              {success && <p className="form-success">{success}</p>}
              <div className="form-actions full">
                <button type="submit" disabled={busy || !totals.complete}>{busy ? "Saving…" : "Apply to Selected Lines"}</button>
                <button type="button" className="secondary" onClick={skipCurrent}>Skip for now</button>
                <button type="button" className="secondary" onClick={() => { setQueueOpen(closeQueue().open); setQueueNotice(""); setSuccess(""); resetDraft(); }}>Close</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
