"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
import { closeQueue, queueBannerLabel, queueSessionProgressLabel, skipQueueIndex } from "@/domain/compensationQueue";
import { defaultLineApplyMode, plannedAllocationTargets, type LineApplyMode } from "@/domain/allocationBulkApply";
import { allocationSavedMessage, isAllocationOverlapMessage, runAllocationSaveFlow } from "@/domain/allocationSaveFlow";
import {
  compensationGroupSummaries,
  currentAllocationsForGroup,
  filterCompensationGroups,
  groupActiveCountLabel,
  historicalAllocationsForGroup,
  missingLinesForGroup,
  allocationRecipientSummary,
} from "@/domain/compensationHome";
import { runTeamSaveFlow, teamSavedMessage } from "@/domain/teamSaveFlow";
import { linesForGroupSelection, type GroupLineEvidence } from "@/domain/activeGroupLines";
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
  initialQueue?: CompensationQueueItem[];
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
  allocationsRef.current = allocations;

  const currentQueueItem = queue[queueIndex] ?? null;
  const draftGroupId = Number(draft.groupId) || null;
  const visibleLines = linesForGroupSelection(
    draftGroupId,
    linesOfBusiness,
    groupLineEvidence,
    currentQueueItem && currentQueueItem.groupId === draftGroupId ? [currentQueueItem.lineOfBusinessId] : [],
  );

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
    const nextQueue = await readApiJson<CompensationQueueItem[]>(queueResponse);
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

  async function saveAllocation(event?: FormEvent, advanceQueue = false) {
    event?.preventDefault();
    setError("");
    setSuccess("");
    try {
      await runBusyAction(setBusy, async () => {
        const result = await runAllocationSaveFlow({
          request: async () => {
            const response = await fetchWithDeadline("/api/allocations", {
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
            const body = await readApiJson<{ message?: string }>(response);
            return { ok: response.ok, message: httpFailureMessage(response.status, body.message) };
          },
          refresh,
          savedKey: advanceQueue && currentQueueItem ? currentQueueItem.key : null,
          queueIndex,
        });
        if (result.error) {
          setError(result.error);
          setQueueNotice("");
          return;
        }
        setQueue(result.queue);
        setQueueIndex(result.queueIndex);
        setQueueDone(result.queueDone);
        setQueueOpen(result.queueOpen);
        setQueueNotice(result.notice ?? "");
        if (result.loadNext) {
          setSuccess("");
          setQueueSessionPosition((position) => position + 1);
          loadQueueItem(result.queue[result.queueIndex] ?? null, allocationsRef.current);
        } else if (result.recovered) {
          setSuccess(result.success ?? allocationSavedMessage());
          if (!result.queueOpen) resetDraft();
        } else if (result.stillQueued) {
          setSuccess(result.success ?? allocationSavedMessage());
        } else {
          setSuccess(result.success ?? allocationSavedMessage());
          if (!result.queueOpen) resetDraft();
        }
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to save allocation."));
    }
  }

  async function saveSelectedLines() {
    setError("");
    setSuccess("");
    const targets = plannedAllocationTargets({
      lineIds: applyLines.map((line) => line.id),
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
    try {
      await runBusyAction(setBusy, async () => {
        const outcomes: string[] = [];
        for (const target of targets) {
          const response = await fetchWithDeadline("/api/allocations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              groupId: Number(draft.groupId),
              lineOfBusinessId: target.lineOfBusinessId,
              effectiveStart: draft.effectiveStart,
              effectiveEnd: draft.effectiveEnd,
              status: "active",
              entries: allocationEntryPayload(
                target.mode === "agency"
                  ? [{ recipientType: "agency", personKind: "", personId: "", teamId: "", percent: "100" }]
                  : draft.entries,
              ),
            }),
          });
          const body = await readApiJson<{ message?: string }>(response);
          const lineName = applyLines.find((line) => line.id === target.lineOfBusinessId)?.name ?? "Line";
          if (!response.ok) {
            outcomes.push(isAllocationOverlapMessage(body.message)
              ? `${lineName}: already saved`
              : `${lineName}: ${httpFailureMessage(response.status, body.message)}`);
            continue;
          }
          outcomes.push(`${lineName}: saved`);
        }
        await refresh();
        const failed = outcomes.filter((item) => !/: (saved|already saved)$/.test(item));
        if (failed.length === targets.length) {
          setError(failed.join(" "));
          return;
        }
        setSuccess(`Applied group compensation to ${targets.length - failed.length} line${targets.length - failed.length === 1 ? "" : "s"}. Posted commissions keep their original payout snapshots.${failed.length ? ` ${failed.join(" ")}` : ""}`);
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

  function loadQueueItem(item: typeof currentQueueItem, sourceAllocations = allocationsRef.current) {
    if (!item) return;
    const existing = sourceAllocations.find((row) => (
      row.groupId === item.groupId && row.lineOfBusinessId === item.lineOfBusinessId && row.status === "active"
    ));
    setDraft({
      groupId: String(item.groupId),
      lineOfBusinessId: String(item.lineOfBusinessId),
      effectiveStart: item.suggestedEffectiveStart,
      effectiveEnd: "",
      entries: existing && !allocationTotals(existing.entries).complete
        ? draftFromAllocationEntries(existing.entries.map((entry) => ({
          recipientType: entry.recipientType,
          personKind: entry.personKind,
          personId: entry.personId,
          teamId: entry.teamId,
          compensationPercent: bpsToPercentString(entry.compensationBps),
        })))
        : draftFromAllocationEntries([{
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
    loadQueueItem(queue[0] ?? null);
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
    loadQueueItem(queue[next.index] ?? null);
  }

  async function changeAllocation(row: { id: number }) {
    const allocation = allocationsRef.current.find((item) => item.id === row.id);
    if (!allocation) return;
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
    setError("Enter a new effective start month, then save. The prior allocation will close the month before.");
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
  const selectedCurrent = selectedGroupId ? currentAllocationsForGroup(allocations, selectedGroupId) : [];
  const selectedHistory = selectedGroupId ? historicalAllocationsForGroup(allocations, selectedGroupId) : [];
  const selectedMissing = selectedGroupId
    ? missingLinesForGroup(selectedGroupId, groupLineEvidence, linesOfBusiness, allocations)
    : [];
  const coveredLineIds = selectedCurrent.map((row) => row.lineOfBusinessId);
  const applyLines = draftGroupId ? visibleLines : [];

  useEffect(() => {
    setLineModes({});
  }, [draftGroupId]);

  useEffect(() => {
    if (!draftGroupId) return;
    const missingIds = selectedMissing.map((item) => item.id);
    const selectedLineId = Number(draft.lineOfBusinessId) || null;
    setLineModes((current) => {
      const next: Record<number, LineApplyMode> = {};
      for (const line of applyLines) {
        next[line.id] = current[line.id] ?? defaultLineApplyMode(line.id, selectedLineId, missingIds, coveredLineIds);
      }
      return next;
    });
    // Recalculate defaults for newly visible lines, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGroupId, draft.lineOfBusinessId, applyLines.map((line) => line.id).join(","), selectedMissing.map((line) => line.id).join(","), coveredLineIds.join(",")]);

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
            <p className="eyebrow">Browse by group</p>
            <h2>Compensation</h2>
            <p>Search a group to see its current allocations. The work queue is for missing Group + LOB setup. Posted commissions keep their original payout snapshots.</p>
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
                    <button type="button" className="linkish" onClick={() => { setSelectedGroupId(group.groupId); setShowHistory(false); }}>
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
            <p>Current allocations for this group. Change Allocation opens the complete Group + LOB plan. History stays available and is not rewritten.</p>
          </div>
        </div>
        <h3>Current compensation</h3>
        {selectedCurrent.length === 0 ? (
          <p className="empty">This group has no active allocation.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>LOB</th>
                <th>Recipients</th>
                <th>Effective</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {selectedCurrent.map((row) => (
                <tr key={row.id}>
                  <td>{row.lineOfBusinessName}</td>
                  <td>{allocationRecipientSummary(row)}</td>
                  <td>{formatStatementMonth(row.effectiveStart)} – {row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : "Present"}</td>
                  <td>{row.status}</td>
                  <td>
                    <div className="form-actions">
                      <button type="button" className="secondary" onClick={() => void changeAllocation(row)}>Change Allocation</button>
                      <button type="button" className="secondary" onClick={() => void deactivate(row.id)}>Deactivate</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedMissing.length > 0 && (
          <div className="related-block">
            <strong>Set up missing LOB allocation</strong>
            <div className="form-actions" style={{ marginTop: 10 }}>
              {selectedMissing.map((line) => (
                <button
                  key={line.id}
                  type="button"
                  className="secondary"
                  onClick={() => setDraft({
                    groupId: String(selectedGroup.id),
                    lineOfBusinessId: String(line.id),
                    effectiveStart: "",
                    effectiveEnd: "",
                    entries: draftFromAllocationEntries([{
                      recipientType: "person",
                      personKind: "agent",
                      personId: null,
                      compensationPercent: "",
                    }]),
                  })}
                >
                  Set up {line.name}
                </button>
              ))}
            </div>
          </div>
        )}
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
          {applyLines.length > 0 && (
            <div className="related-block full">
              <strong>Apply this setup to lines of business</strong>
              <p>Enter recipients once. Apply the same split to selected lines, set a line to Agency 100% when it has no recipient compensation, or skip a line. This creates separate Group + LOB allocations and does not rewrite posted payouts.</p>
              {applyLines.map((line) => (
                <label key={line.id} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                  <span style={{ minWidth: 140 }}>{line.name}</span>
                  <select
                    aria-label={`Apply mode for ${line.name}`}
                    value={lineModes[line.id] ?? "skip"}
                    onChange={(event) => setLineModes((current) => ({ ...current, [line.id]: event.target.value as LineApplyMode }))}
                  >
                    <option value="template">Use this setup</option>
                    <option value="agency">Agency 100% / no recipient compensation</option>
                    <option value="skip">Skip</option>
                  </select>
                </label>
              ))}
            </div>
          )}
          <p className={totals.complete ? "form-success full" : "allocation-progress full"}>{allocationProgressLabel(draft.entries.flatMap((entry) => {
            try { return [{ compensationBps: parsePercentToBps(entry.percent || "0") }]; } catch { return []; }
          }))}</p>
          {error && !queueOpen && <p className="form-error">{error}</p>}
          {success && !queueOpen && <p className="form-success">{success}</p>}
          <div className="form-actions full">
            <button disabled={busy || !totals.complete}>{busy ? "Saving…" : "Save allocation"}</button>
            <button type="button" disabled={busy || !totals.complete || applyLines.length === 0} onClick={() => void saveSelectedLines()}>
              Save for selected lines
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
            <p>{currentQueueItem.lineOfBusinessName} · {currentQueueItem.reasonLabel} · {queueSessionProgressLabel(queueSessionPosition, queueSessionTotal || queue.length)}</p>
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
              {queueNotice && <p className="muted-note">{queueNotice}</p>}
              {success && <p className="form-success">{success}</p>}
              <div className="form-actions full">
                <button disabled={busy || !totals.complete}>{busy ? "Saving…" : "Save & Next"}</button>
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
