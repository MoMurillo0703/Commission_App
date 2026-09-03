"use client";

import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent } from "@/db/schema";
import {
  addDraftRecipient,
  personRoleLabel,
  removeDraftRecipient,
  type DraftRecipient,
} from "@/domain/allocationEditor";
import { MAX_DIRECT_PERSONS } from "@/domain/allocations";

export function AllocationRecipientEditor({
  entries,
  agents,
  accountManagers,
  teams,
  onChange,
}: {
  entries: DraftRecipient[];
  agents: Agent[];
  accountManagers: AccountManager[];
  teams: TeamView[];
  onChange: (entries: DraftRecipient[]) => void;
}) {
  const personCount = entries.filter((entry) => entry.recipientType === "person").length;
  const hasAgency = entries.some((entry) => entry.recipientType === "agency");

  function update(index: number, patch: Partial<DraftRecipient>) {
    onChange(entries.map((entry, itemIndex) => itemIndex === index ? { ...entry, ...patch } : entry));
  }

  return (
    <div className="full">
      <table className="recipient-table">
        <thead>
          <tr>
            <th>Role</th>
            <th>Recipient</th>
            <th>Split %</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.recipientType}-${index}`}>
              <td>
                {entry.recipientType === "agency" && <span className="pill">Agency</span>}
                {entry.recipientType === "team" && <span className="pill">Team</span>}
                {entry.recipientType === "person" && (
                  <select
                    aria-label={`Person role ${index + 1}`}
                    value={entry.personKind || "agent"}
                    onChange={(event) => update(index, {
                      personKind: event.target.value === "account_manager" ? "account_manager" : "agent",
                      personId: "",
                    })}
                  >
                    <option value="agent">Agent</option>
                    <option value="account_manager">Account manager</option>
                  </select>
                )}
              </td>
              <td>
                {entry.recipientType === "agency" && "Murillo Insurance"}
                {entry.recipientType === "person" && (
                  <select
                    aria-label={`${personRoleLabel(entry.personKind)} ${index + 1}`}
                    value={entry.personId}
                    onChange={(event) => update(index, { personId: event.target.value })}
                  >
                    <option value="">Select {personRoleLabel(entry.personKind).toLowerCase()}</option>
                    {(entry.personKind === "account_manager" ? accountManagers : agents).map((person) => (
                      <option key={person.id} value={person.id}>{person.name} · {personRoleLabel(entry.personKind)}</option>
                    ))}
                  </select>
                )}
                {entry.recipientType === "team" && (
                  <select
                    aria-label={`Team ${index + 1}`}
                    value={entry.teamId}
                    onChange={(event) => update(index, { teamId: event.target.value })}
                  >
                    <option value="">Select team</option>
                    {teams.filter((team) => team.status === "active").map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                <input
                  aria-label={`Split ${index + 1}`}
                  value={entry.percent}
                  onChange={(event) => update(index, { percent: event.target.value })}
                  placeholder="70"
                  required
                />
              </td>
              <td>
                <button type="button" className="secondary remove-row" onClick={() => onChange(removeDraftRecipient(entries, index))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        <button
          type="button"
          className="secondary"
          disabled={personCount >= MAX_DIRECT_PERSONS}
          onClick={() => onChange(addDraftRecipient(entries, "person", "agent"))}
        >
          Add Agent
        </button>
        <button
          type="button"
          className="secondary"
          disabled={personCount >= MAX_DIRECT_PERSONS}
          onClick={() => onChange(addDraftRecipient(entries, "person", "account_manager"))}
        >
          Add Account Manager
        </button>
        <button type="button" className="secondary" onClick={() => onChange(addDraftRecipient(entries, "team"))}>
          Add Team
        </button>
        <button
          type="button"
          className="secondary"
          disabled={hasAgency}
          onClick={() => onChange(addDraftRecipient(entries, "agency"))}
        >
          Add Agency Share
        </button>
      </div>
      <p className="muted-note">Up to {MAX_DIRECT_PERSONS} people. Agency and Team do not count toward that limit.</p>
    </div>
  );
}
