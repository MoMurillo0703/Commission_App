"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import type { AccountManager, Agent, Carrier, LineOfBusiness } from "@/db/schema";
import {
  emptyGroupDirectoryFilters,
  filterGroupDirectory,
  GROUP_ALPHABET,
  groupDirectoryCountLabel,
  type GroupDirectoryFilters,
  type GroupDirectoryLetter,
  type GroupDirectoryRow,
} from "@/domain/groupDirectory";

export function GroupsDirectory({
  rows,
  agents,
  accountManagers,
  carriers,
  linesOfBusiness,
}: {
  rows: GroupDirectoryRow[];
  agents: Agent[];
  accountManagers: AccountManager[];
  carriers: Carrier[];
  linesOfBusiness: LineOfBusiness[];
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<GroupDirectoryFilters>(emptyGroupDirectoryFilters);
  const [name, setName] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdHref, setCreatedHref] = useState("");

  const visible = useMemo(() => filterGroupDirectory(rows, filters), [filters, rows]);

  function patch(next: Partial<GroupDirectoryFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, groupNumber }),
    });
    const body = await response.json() as { id?: number; message?: string };
    setBusy(false);
    if (!response.ok || !body.id) {
      setError(body.message ?? "Unable to create the group.");
      return;
    }
    const href = `/groups/${body.id}`;
    setCreatedHref(href);
    router.push(href);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Account management</p>
          <h2>Groups</h2>
          <p>Search and filter Groups, then open a Group to manage assignments, compensation, and commissions.</p>
        </div>
      </div>
      <div className="directory-toolbar">
        <label>
          Search
          <input
            value={filters.query}
            onChange={(event) => patch({ query: event.target.value })}
            placeholder="Name, group number, or carrier group number"
          />
        </label>
        <label>
          Carrier
          <select value={filters.carrierId ?? ""} onChange={(event) => patch({ carrierId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All carriers</option>
            {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
          </select>
        </label>
        <label>
          Line of Business
          <select value={filters.lineOfBusinessId ?? ""} onChange={(event) => patch({ lineOfBusinessId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All lines</option>
            {linesOfBusiness.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
          </select>
        </label>
        <label>
          Primary Agent
          <select value={filters.primaryAgentId ?? ""} onChange={(event) => patch({ primaryAgentId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All primary agents</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>
        <label>
          Account Manager
          <select value={filters.accountManagerId ?? ""} onChange={(event) => patch({ accountManagerId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All account managers</option>
            {accountManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
          </select>
        </label>
        <label>
          Compensation
          <select value={filters.compensationStatus} onChange={(event) => patch({ compensationStatus: event.target.value as GroupDirectoryFilters["compensationStatus"] })}>
            <option value="all">All statuses</option>
            <option value="configured">Configured</option>
            <option value="default">Default / not explicitly configured</option>
            <option value="review_required">Review required</option>
          </select>
        </label>
      </div>
      <div className="form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filters.unassignedPrimaryAgent}
            onChange={(event) => patch({ unassignedPrimaryAgent: event.target.checked })}
          />
          Unassigned Primary Agent
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={filters.unassignedAccountManager}
            onChange={(event) => patch({ unassignedAccountManager: event.target.checked })}
          />
          Unassigned Account Manager
        </label>
        <button type="button" className="secondary" onClick={() => setFilters(emptyGroupDirectoryFilters())}>
          Clear Filters
        </button>
        <span className="muted-note">{groupDirectoryCountLabel(visible.length, rows.length)}</span>
      </div>
      <div className="alpha-nav" aria-label="Alphabet">
        {GROUP_ALPHABET.map((letter) => (
          <button
            key={letter}
            type="button"
            className={filters.letter === letter ? "" : "secondary"}
            onClick={() => patch({ letter: letter as GroupDirectoryLetter })}
          >
            {letter === "all" ? "All" : letter}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="empty">No groups match these filters.</p>
      ) : (
        <table className="directory-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Primary Agent</th>
              <th>Account Manager</th>
              <th>Carriers</th>
              <th>Coverage</th>
              <th>Compensation</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((group) => (
              <tr key={group.id}>
                <td>
                  <Link href={`/groups/${group.id}`}><strong>{group.name}</strong></Link>
                  {group.groupNumber ? <small> · {group.groupNumber}</small> : null}
                </td>
                <td>{group.primaryAgentName ?? "—"}</td>
                <td>{group.accountManagerName ?? "—"}</td>
                <td>{group.carrierNames.join(", ") || "—"}</td>
                <td>{group.lineOfBusinessNames.join(", ") || "—"}</td>
                <td>
                  <span className={`pill ${group.compensationKind === "review_required" ? "review" : group.compensationKind === "explicit_configured" || group.compensationKind === "explicit_agency" ? "posted" : "mapped"}`}>
                    {group.compensationLabel}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form-grid form-grid-wide" onSubmit={createGroup} style={{ marginTop: 28 }}>
        <p className="full"><strong>Add a Group</strong></p>
        <label>
          Group name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Legacy group number
          <input value={groupNumber} onChange={(event) => setGroupNumber(event.target.value)} />
        </label>
        <div className="form-actions full">
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Create Group"}</button>
          {createdHref ? <Link href={createdHref}>Open created group</Link> : null}
        </div>
        {error ? <p className="form-error full">{error}</p> : null}
      </form>
    </section>
  );
}
