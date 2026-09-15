"use client";

import { useEffect, useMemo, useState } from "react";
import { PeopleSplitEditor, type PeopleSplitRow } from "@/components/PeopleSplitEditor";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Carrier, LineOfBusiness } from "@/db/schema";
import {
  directoryBulkSelectionControl,
  directoryOwnerCoverageWarning,
  emptyCompensationDirectoryFilters,
  type CompensationDirectoryFilters,
  type CompensationDirectoryRow,
} from "@/domain/compensationDirectory";
import {
  buildBulkCompensationRequestBody,
  bulkCompensationCommitBody,
  bulkCompensationCommitReady,
  bulkCompensationPreviewBlockReason,
  directorySelectionAfterReload,
  type BulkCompensationEditorRequest,
} from "@/domain/bulkCompensationEditor";
import type { PersonIdentity } from "@/domain/agencyOwner";
import { currentPaidMonth } from "@/domain/dates";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";

const PAGE_SIZE = 50;

type DirectoryResponse = {
  rows: CompensationDirectoryRow[];
  keys: string[];
  targets: Array<{ key: string; groupId: number; lineOfBusinessId: number }>;
  owner: PersonIdentity | null;
  total: number;
  groupCount: number;
};

type PreviewResponse = {
  previewToken: string;
  effectiveStart: string;
  groupCount: number;
  targetCount: number;
  proposedSummary: string;
  proposedPeople: Array<{ name: string; compensationBps: number }>;
  rows: Array<{
    key: string;
    groupName: string;
    lineOfBusinessName: string;
    action: string;
    currentSummary: string;
    proposedSummary: string;
    closePriorEnd: string | null;
    warning: string | null;
  }>;
  hasConflicts: boolean;
};

export function CompensationDirectoryPanel({
  initialRows,
  initialAsOfMonth,
  initialQuery = "",
  requestedQuery,
  requestedStatus,
  requestedAsOfMonth,
  agents,
  accountManagers,
  linesOfBusiness,
  carriers,
  teams,
  owner: initialOwner,
}: {
  initialRows: CompensationDirectoryRow[];
  initialAsOfMonth: string;
  initialQuery?: string;
  requestedQuery?: string | null;
  requestedStatus?: CompensationDirectoryFilters["compensationStatus"] | null;
  requestedAsOfMonth?: string | null;
  agents: Agent[];
  accountManagers: AccountManager[];
  linesOfBusiness: LineOfBusiness[];
  carriers: Carrier[];
  teams: TeamView[];
  owner: PersonIdentity | null;
}) {
  const [filters, setFilters] = useState<CompensationDirectoryFilters>({
    ...emptyCompensationDirectoryFilters(initialAsOfMonth || currentPaidMonth()),
    query: initialQuery,
  });
  const [appliedQuery, setAppliedQuery] = useState(requestedQuery ?? initialQuery ?? "");
  const [appliedStatus, setAppliedStatus] = useState(requestedStatus ?? null);
  const [appliedAsOfMonth, setAppliedAsOfMonth] = useState(requestedAsOfMonth ?? null);
  const [rows, setRows] = useState(initialRows);
  const [targets, setTargets] = useState<DirectoryResponse["targets"]>(
    initialRows.map((row) => ({ key: row.key, groupId: row.groupId, lineOfBusinessId: row.lineOfBusinessId })),
  );
  const [owner, setOwner] = useState<PersonIdentity | null>(initialOwner);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [mode, setMode] = useState<"template" | "custom">("template");
  const [effectiveStart, setEffectiveStart] = useState(filters.asOfMonth);
  const [teamId, setTeamId] = useState("");
  const [people, setPeople] = useState<PeopleSplitRow[]>([{ personKind: "agent", personId: "", percent: "" }]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewedRequest, setPreviewedRequest] = useState<BulkCompensationEditorRequest | null>(null);

  const visible = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const selectedTargets = useMemo(
    () => targets.filter((target) => selected.has(target.key)),
    [selected, targets],
  );
  const editorState = {
    effectiveStart,
    mode,
    teamId,
    people,
    targets: selectedTargets.map((target) => ({
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
    })),
  };
  const previewBlockReason = bulkCompensationPreviewBlockReason(editorState);
  const commitReady = bulkCompensationCommitReady(preview, previewedRequest);

  useEffect(() => {
    if (editorOpen) return;
    let cancelled = false;
    async function load() {
      const params = new URLSearchParams();
      if (filters.query) params.set("query", filters.query);
      if (filters.carrierId) params.set("carrierId", String(filters.carrierId));
      if (filters.lineOfBusinessId) params.set("lineOfBusinessId", String(filters.lineOfBusinessId));
      if (filters.primaryAgentId) params.set("primaryAgentId", String(filters.primaryAgentId));
      if (filters.accountManagerId) params.set("accountManagerId", String(filters.accountManagerId));
      if (filters.recipientKey) params.set("recipientKey", filters.recipientKey);
      if (filters.teamId) params.set("teamId", String(filters.teamId));
      if (filters.compensationStatus !== "all") params.set("compensationStatus", filters.compensationStatus);
      params.set("asOfMonth", filters.asOfMonth);
      const response = await fetchWithDeadline(`/api/compensation/directory?${params.toString()}`);
      const body = await readApiJson<DirectoryResponse>(response);
      if (cancelled) return;
      if (!response.ok) {
        setError(body && "message" in body ? String((body as { message?: string }).message) : "Unable to load compensation targets.");
        return;
      }
      setRows(body.rows);
      setTargets(body.targets);
      setOwner(body.owner ?? null);
      setSelected((current) => new Set(directorySelectionAfterReload({
        editorOpen: false,
        selectedKeys: [...current],
        nextKeys: body.keys,
      })));
      setPage(0);
    }
    void load();
    return () => { cancelled = true; };
  }, [filters, editorOpen]);

  if (!editorOpen && requestedQuery && requestedQuery !== appliedQuery) {
    setAppliedQuery(requestedQuery);
    setFilters((current) => ({ ...current, query: requestedQuery }));
  }
  if (!editorOpen && requestedStatus && requestedStatus !== appliedStatus) {
    setAppliedStatus(requestedStatus);
    setFilters((current) => ({ ...current, compensationStatus: requestedStatus }));
  }
  if (!editorOpen && requestedAsOfMonth && requestedAsOfMonth !== appliedAsOfMonth) {
    setAppliedAsOfMonth(requestedAsOfMonth);
    setFilters((current) => ({ ...current, asOfMonth: requestedAsOfMonth }));
  }

  function patch(next: Partial<CompensationDirectoryFilters>) {
    setFilters((current) => ({ ...current, ...next }));
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAllMatching() {
    setSelected(new Set(targets.map((target) => target.key)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const selectionControl = directoryBulkSelectionControl(selected.size, targets.length);
  const ownerWarning = directoryOwnerCoverageWarning(owner, editorOpen ? effectiveStart : filters.asOfMonth);

  function clearPreview() {
    setPreview(null);
    setPreviewedRequest(null);
  }

  async function runPreview() {
    setError("");
    if (previewBlockReason) {
      setError(previewBlockReason);
      return;
    }
    const request = buildBulkCompensationRequestBody(editorState);
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline("/api/compensation/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        const body = await readApiJson<PreviewResponse & { message?: string }>(response);
        if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
        setPreview(body);
        setPreviewedRequest(request);
        setSuccess("");
      });
    } catch (caught) {
      setPreview(null);
      setPreviewedRequest(null);
      setError(requestFailureMessage(caught, "Unable to preview compensation."));
    }
  }

  async function commit() {
    if (!preview || !previewedRequest || !commitReady) return;
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline("/api/compensation/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bulkCompensationCommitBody(previewedRequest, preview.previewToken)),
        });
        const body = await readApiJson<{ message?: string; targetCount?: number }>(response);
        if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
        setSuccess(`Saved compensation for ${body.targetCount ?? previewedRequest.targets.length} Group + line targets.`);
        clearPreview();
        setEditorOpen(false);
        setSelected(new Set());
        patch({ asOfMonth: filters.asOfMonth });
      });
    } catch (caught) {
      setError(requestFailureMessage(caught, "Unable to save compensation."));
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">Person-centric compensation</p>
          <h2>Compensation directory</h2>
          <p>Filter Group + Line of Coverage targets, select one or all matching results, then apply a template or custom people split.</p>
        </div>
      </div>
      <div className="directory-toolbar">
        <label>
          Search
          <input value={filters.query} onChange={(event) => patch({ query: event.target.value })} placeholder="Group name or number" />
        </label>
        <label>
          Carrier
          <select value={filters.carrierId ?? ""} onChange={(event) => patch({ carrierId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All carriers</option>
            {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
          </select>
        </label>
        <label>
          Line of Coverage
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
          Recipient
          <select value={filters.recipientKey ?? ""} onChange={(event) => patch({ recipientKey: event.target.value || null })}>
            <option value="">All people</option>
            {peopleCompensationPeople()}
          </select>
        </label>
        <label>
          Template
          <select value={filters.teamId ?? ""} onChange={(event) => patch({ teamId: event.target.value ? Number(event.target.value) : null })}>
            <option value="">All templates</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        <label>
          Status
          <select value={filters.compensationStatus} onChange={(event) => patch({ compensationStatus: event.target.value as CompensationDirectoryFilters["compensationStatus"] })}>
            <option value="all">All</option>
            <option value="configured">Configured</option>
            <option value="default">Default / Mo 100%</option>
            <option value="review_required">Review required</option>
          </select>
        </label>
        <label>
          Effective month
          <input type="month" value={filters.asOfMonth} onChange={(event) => patch({ asOfMonth: event.target.value })} />
        </label>
      </div>
      <div className="form-actions" style={{ marginTop: 16, flexWrap: "wrap" }}>
        <button
          type="button"
          className="secondary"
          onClick={() => selectionControl.action === "clear" ? clearSelection() : selectAllMatching()}
          disabled={selectionControl.disabled}
        >
          {selectionControl.label}
        </button>
        <p><strong>{selected.size}</strong> selected · {targets.length} matching Group + line targets</p>
        <button type="button" disabled={selected.size === 0} onClick={() => { setEditorOpen(true); clearPreview(); setError(""); setEffectiveStart(filters.asOfMonth); }}>
          Edit compensation
        </button>
      </div>
      {ownerWarning && <p className="form-error">{ownerWarning}</p>}
      {error && <p className="form-error">{error}</p>}
      {success && <p className="result">{success}</p>}
      {rows.length === 0 ? (
        <p className="empty">No durable Group + Line of Coverage targets match these filters.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Group</th>
              <th>Carrier</th>
              <th>Line of Coverage</th>
              <th>Primary Agent</th>
              <th>Account Manager</th>
              <th>Current compensation</th>
              <th>Effective period</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} className={selected.has(row.key) ? "selected-row" : undefined}>
                <td>
                  <input type="checkbox" checked={selected.has(row.key)} onChange={() => toggle(row.key)} aria-label={`Select ${row.groupName} ${row.lineOfBusinessName}`} />
                </td>
                <td>
                  <strong>{row.groupName}</strong>
                  {row.groupNumber ? <div>{row.groupNumber}</div> : null}
                </td>
                <td>{row.carrierNames.join(", ") || "—"}</td>
                <td>{row.lineOfBusinessName}</td>
                <td>{row.primaryAgentName ?? "—"}</td>
                <td>{row.accountManagerName ?? "—"}</td>
                <td>
                  <span className={`pill ${row.compensationKind === "review_required" ? "review" : row.compensationKind === "explicit_configured" || row.compensationKind === "explicit_agency" ? "posted" : "mapped"}`}>
                    {row.compensationKind === "review_required" ? "Review" : row.compensationKind.startsWith("explicit") ? "Configured" : "Default"}
                  </span>
                  <div>{row.compensationLabel}</div>
                </td>
                <td>
                  {row.currentEffectiveStart
                    ? `${row.currentEffectiveStart}${row.currentEffectiveEnd ? ` → ${row.currentEffectiveEnd}` : " onward"}`
                    : "Mo 100% default"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > PAGE_SIZE && (
        <div className="form-actions" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
          <p>Page {page + 1} of {Math.ceil(rows.length / PAGE_SIZE)}</p>
          <button type="button" className="secondary" disabled={(page + 1) * PAGE_SIZE >= rows.length} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {editorOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bulk-compensation-title">
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h2 id="bulk-compensation-title">Edit compensation</h2>
            <p>{selected.size} selected targets. Effective-dated change applies from the start month forward. History stays unchanged.</p>
            <div className="form-grid">
              <label>
                Effective start month
                <input type="month" value={effectiveStart} onChange={(event) => { setEffectiveStart(event.target.value); clearPreview(); }} />
              </label>
              <label>
                Apply
                <select value={mode} onChange={(event) => { setMode(event.target.value === "custom" ? "custom" : "template"); clearPreview(); }}>
                  <option value="template">Compensation template</option>
                  <option value="custom">Custom split</option>
                </select>
              </label>
              {mode === "template" ? (
                <label className="full">
                  Template
                  <select value={teamId} onChange={(event) => { setTeamId(event.target.value); clearPreview(); }}>
                    <option value="">Select template</option>
                    {teams.filter((team) => team.status === "active").map((team) => (
                      <option key={team.id} value={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <PeopleSplitEditor
                  people={people}
                  agents={agents}
                  accountManagers={accountManagers}
                  owner={owner}
                  onChange={(next) => { setPeople(next); clearPreview(); }}
                />
              )}
            </div>
            {ownerWarning && <p className="form-error">{ownerWarning}</p>}
            {error && <p className="form-error">{error}</p>}
            {preview && (
              <div className="result">
                <p><strong>{preview.groupCount}</strong> Groups · <strong>{preview.targetCount}</strong> Group + line targets · effective {preview.effectiveStart}</p>
                <p>{preview.proposedSummary} · total 100%</p>
                {preview.hasConflicts && <p className="form-error">Conflicts must be resolved. Nothing will be saved.</p>}
                <table>
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Line</th>
                      <th>Current</th>
                      <th>Proposed</th>
                      <th>Period change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => (
                      <tr key={row.key}>
                        <td>{row.groupName}</td>
                        <td>{row.lineOfBusinessName}</td>
                        <td>{row.currentSummary}</td>
                        <td>{row.proposedSummary}</td>
                        <td>
                          {row.action === "reuse" && "Unchanged / reused"}
                          {row.action === "create" && "New period begins"}
                          {row.action === "version" && `Closes ${row.closePriorEnd ?? "prior"} · begins ${preview.effectiveStart}`}
                          {row.action === "conflict" && (row.warning ?? "Conflict")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="secondary" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button type="button" className="secondary" disabled={busy} onClick={() => void runPreview()}>Preview</button>
              <button type="button" disabled={busy || !commitReady} onClick={() => void commit()}>Commit</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  function peopleCompensationPeople() {
    const options = [
      ...agents.map((agent) => ({ key: `agent:${agent.id}`, label: owner?.personKind === "agent" && owner.personId === agent.id ? "Mo" : agent.name })),
      ...accountManagers.map((manager) => ({ key: `account_manager:${manager.id}`, label: owner?.personKind === "account_manager" && owner.personId === manager.id ? "Mo" : manager.name })),
    ];
    return options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>);
  }
}
