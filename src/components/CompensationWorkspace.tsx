"use client";

import { FormEvent, useState } from "react";
import { CompensationDirectoryPanel } from "@/components/CompensationDirectoryPanel";
import type { CompensationDirectoryFilters, CompensationDirectoryRow } from "@/domain/compensationDirectory";
import { CompensationCorrectionDialog } from "@/components/CompensationCorrectionDialog";
import type { AllocationView } from "@/data/allocations";
import { queueBannerLabel, type GroupCompensationQueueItem } from "@/domain/compensationQueue";
import {
  exceptionWorkSummary,
  groupCompensationExceptions,
  remainingSettlementMessage,
  type PostedCompensationException,
} from "@/domain/compensationExceptions";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Carrier, Group, LineOfBusiness } from "@/db/schema";
import { personRoleLabel } from "@/domain/allocationEditor";
import { runTeamSaveFlow, teamSavedMessage } from "@/domain/teamSaveFlow";
import type { GroupLineEvidence } from "@/domain/activeGroupLines";
import { currentPaidMonth, formatStatementMonth } from "@/domain/dates";
import type { PersonIdentity } from "@/domain/agencyOwner";
import type { CompensationGroupClass, NamedBusinessPerson } from "@/domain/businessCompensation";
import { bpsToPercentString } from "@/domain/money";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

export function CompensationWorkspace({
  agents,
  accountManagers,
  linesOfBusiness,
  initialAllocations,
  initialTeams,
  initialQueue = [],
  focusAllocationId = null,
  reviewContext = null,
  agencyOwner = null,
  compensationDirectory = [],
  carriers = [],
  initialAsOfMonth,
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
  reviewContext?: {
    paidMonth: string;
    personName: string | null;
    commissions: PostedCompensationException[];
  } | null;
  agencyOwner?: PersonIdentity | null;
  namedPeople?: NamedBusinessPerson[];
  directory?: CompensationGroupClass[];
  compensationDirectory?: CompensationDirectoryRow[];
  carriers?: Carrier[];
  initialAsOfMonth?: string;
}) {
  const focusedAllocation = focusAllocationId
    ? initialAllocations.find((allocation) => allocation.id === focusAllocationId) ?? null
    : null;
  const [teams, setTeams] = useState(initialTeams);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamMembers, setTeamMembers] = useState<Array<{ personKind: "agent" | "account_manager"; personId: string; percent: string }>>([{ personKind: "agent", personId: "", percent: "" }]);
  const [reviewActive, setReviewActive] = useState(Boolean(reviewContext));
  const [reviewCommissions, setReviewCommissions] = useState(reviewContext?.commissions ?? []);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionIds, setCorrectionIds] = useState<number[]>([]);
  const [confirmationKey, setConfirmationKey] = useState("");
  const [directoryQuery, setDirectoryQuery] = useState(focusedAllocation?.groupName ?? "");
  const [directoryStatus, setDirectoryStatus] = useState<CompensationDirectoryFilters["compensationStatus"] | null>(null);
  const [directoryMonth, setDirectoryMonth] = useState<string | null>(reviewContext?.paidMonth ?? initialAsOfMonth ?? null);

  const exceptionGroups = reviewActive && reviewContext
    ? groupCompensationExceptions(reviewCommissions, initialAllocations)
    : [];
  const exceptionWork = exceptionWorkSummary(exceptionGroups);

  async function refreshTeams(failureMessage = "Team saved, but the page could not refresh. Reload Compensation to continue.") {
    const teamsResponse = await fetchWithDeadline("/api/teams");
    const nextTeams = await readApiJson<TeamView[]>(teamsResponse);
    if (!teamsResponse.ok) throw new Error(failureMessage);
    setTeams(nextTeams);
    return { teams: nextTeams };
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    const start = directoryMonth || currentPaidMonth();
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
          refresh: async () => refreshTeams(),
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
    } catch (caught) {
      setError(requestFailureMessage(caught, "Unable to save team."));
    }
  }

  function findGroupInDirectory(groupName: string, paidMonth?: string) {
    setDirectoryQuery(groupName);
    if (paidMonth) setDirectoryMonth(paidMonth);
    setDirectoryStatus(null);
  }

  return (
    <>
      {reviewActive && reviewContext && (
        <section className="panel queue-banner">
          <div>
            <p className="eyebrow">Compensation requires review</p>
            <h2>{reviewContext.personName ? `${reviewContext.personName} · ${formatStatementMonth(reviewContext.paidMonth)}` : formatStatementMonth(reviewContext.paidMonth)}</h2>
            {exceptionWork.groupCount > 0 && (
              <p>{exceptionWork.groupCount} Group{exceptionWork.groupCount === 1 ? "" : "s"} / {exceptionWork.commissionCount} commission record{exceptionWork.commissionCount === 1 ? "" : "s"} require review</p>
            )}
            <p>{remainingSettlementMessage(reviewCommissions.length)}</p>
          </div>
          <div className="form-actions">
            {exceptionWork.readyCommissionIds.length > 0 && (
              <button type="button" onClick={() => {
                setCorrectionIds(exceptionWork.readyCommissionIds);
                setConfirmationKey(crypto.randomUUID());
                setCorrectionOpen(true);
              }}>Correct Compensation</button>
            )}
            <button type="button" className="secondary" onClick={() => setReviewActive(false)}>Exit filtered review</button>
          </div>
        </section>
      )}

      {reviewActive && reviewContext && exceptionWork.groupCount > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Affected Groups</p>
              <h2>Eligible Agency 100% fallback commissions</h2>
              <p>Search the Group in the directory, select the lines, Edit Compensation for the original paid month, Preview, and Commit. Then use Correct Compensation. Allocations never rewrite payouts by themselves.</p>
            </div>
          </div>
          {exceptionWork.groups.map((group) => (
            <article key={group.groupId} className="allocation-card">
              <button
                type="button"
                className="linkish"
                onClick={() => findGroupInDirectory(group.groupName, reviewContext.paidMonth)}
              >
                <strong>{group.groupName}</strong>
              </button>
              <table>
                <thead>
                  <tr>
                    <th>Coverage</th>
                    <th>Status</th>
                    <th>Commission IDs</th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => (
                    <tr key={line.lineOfBusinessId}>
                      <td>{line.lineOfBusinessName}</td>
                      <td>{line.statusLabel}</td>
                      <td>{line.commissionIds.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          ))}
        </section>
      )}

      {initialQueue.length > 0 && !reviewActive && (
        <section className="panel queue-banner">
          <div>
            <p className="eyebrow">Needs attention</p>
            <h2>{queueBannerLabel(initialQueue)}</h2>
            <p>{initialQueue.length} group{initialQueue.length === 1 ? "" : "s"} {initialQueue.length === 1 ? "has" : "have"} Lines of Coverage that still need compensation. Search a Group below or filter Status to Default / Mo 100%, then select lines and Edit Compensation.</p>
          </div>
          <button type="button" className="secondary" onClick={() => setDirectoryStatus("default")}>
            Show default Mo 100% targets
          </button>
        </section>
      )}

      <CompensationDirectoryPanel
        initialRows={compensationDirectory}
        initialAsOfMonth={directoryMonth || currentPaidMonth()}
        initialQuery={directoryQuery}
        requestedQuery={directoryQuery || null}
        requestedStatus={directoryStatus}
        requestedAsOfMonth={directoryMonth}
        agents={agents}
        accountManagers={accountManagers}
        linesOfBusiness={linesOfBusiness}
        carriers={carriers}
        teams={teams}
        owner={agencyOwner ?? null}
      />

      {correctionOpen && correctionIds.length > 0 && (
        <CompensationCorrectionDialog
          commissionIds={correctionIds}
          confirmationKey={confirmationKey}
          onClose={() => setCorrectionOpen(false)}
          onCorrected={(correctedIds) => {
            setReviewCommissions((current) => current.filter((row) => !correctedIds.includes(row.commissionId)));
            setCorrectionOpen(false);
            setSuccess("Compensation correction saved. Canonical payouts now use the paid-month allocation.");
          }}
        />
      )}

      {!reviewActive && <section className="panel recent">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Reusable templates</p>
            <h2>Compensation templates</h2>
            <p>Save a people split as a reusable template. Applying a template later does not rewrite posted commissions or already-applied allocations.</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={saveTeam}>
          <label>
            Template name
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
            <button disabled={busy}>{busy ? "Saving…" : "Save template"}</button>
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
                  <th>Split %</th>
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
      </section>}
    </>
  );
}
