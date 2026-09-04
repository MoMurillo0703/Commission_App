"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImportStatementView } from "@/data/statements";
import { collectPreviewHeaders, mappingFieldLabels, mappingFields, mappingLooksAutomatic, suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import { calculateAgentCompensationCents, calculateAgencyNetCents } from "@/domain/compensation";
import type { UnmatchedImportGroup, GroupImportDecision } from "@/domain/importGroups";
import type { ValidatedImportRow } from "@/domain/importRows";
import { formatCents } from "@/domain/money";
import type { NamedImportDecision, UnmatchedNamedImport } from "@/domain/namedImport";
import { continueImportBlockedReason, type StatementReadiness } from "@/domain/statementReadiness";
import type { StatementPreview } from "@/domain/workbook";

type NamedOption = { id: number; name: string; groupNumber?: string | null };

type PreviewResponse = {
  paidMonth: string;
  rows: ValidatedImportRow[];
  readyCount: number;
  blockedCount: number;
  postedCount: number;
  unmatchedGroups?: UnmatchedImportGroup[];
  unmatchedLines?: UnmatchedNamedImport[];
  unmatchedAgents?: UnmatchedNamedImport[];
  readiness?: StatementReadiness;
  createdCount?: number;
  reusedCount?: number;
  matchedCount?: number;
  conflicts?: string[];
  remainingUnmatchedCount?: number;
  message?: string;
};

function defaultNamedDecisions(items: UnmatchedNamedImport[]) {
  return Object.fromEntries(items.map((item) => [item.key, { key: item.key, action: "create" as const }]));
}

export function StatementPosting({
  statement,
  preview,
}: {
  statement: ImportStatementView;
  preview: StatementPreview;
}) {
  const headers = useMemo(() => collectPreviewHeaders(preview.sheets), [preview.sheets]);
  const [mapping, setMapping] = useState<ColumnMapping>(statement.columnMapping ?? suggestColumnMapping(headers));
  const [review, setReview] = useState<PreviewResponse | null>(null);
  const [groups, setGroups] = useState<NamedOption[]>([]);
  const [lines, setLines] = useState<NamedOption[]>([]);
  const [agents, setAgents] = useState<NamedOption[]>([]);
  const [groupDecisions, setGroupDecisions] = useState<Record<string, GroupImportDecision>>({});
  const [lineDecisions, setLineDecisions] = useState<Record<string, NamedImportDecision>>({});
  const [agentDecisions, setAgentDecisions] = useState<Record<string, NamedImportDecision>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [showMappingHelp, setShowMappingHelp] = useState(() => !mappingLooksAutomatic(statement.columnMapping ?? suggestColumnMapping(headers)));

  useEffect(() => {
    void Promise.all([
      fetch("/api/groups").then(async (response) => { if (response.ok) setGroups(await response.json()); }),
      fetch("/api/lines-of-business").then(async (response) => { if (response.ok) setLines(await response.json()); }),
      fetch("/api/agents").then(async (response) => { if (response.ok) setAgents(await response.json()); }),
    ]);
  }, []);

  function applyReview(body: PreviewResponse) {
    setReview(body);
    setGroupDecisions(Object.fromEntries((body.unmatchedGroups ?? []).map((group) => [group.key, { key: group.key, action: "create" }])));
    setLineDecisions(defaultNamedDecisions(body.unmatchedLines ?? []));
    setAgentDecisions(defaultNamedDecisions(body.unmatchedAgents ?? []));
    if (body.readiness?.blockers.some((blocker) => blocker.kind === "mapping")) {
      setShowMappingHelp(true);
    }
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/statements/${statement.id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping }),
    });
    const body = (await response.json()) as PreviewResponse;
    setBusy(false);
    if (!response.ok) {
      setError((body as { message?: string }).message ?? "Unable to preview rows.");
      return;
    }
    applyReview(body);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/imports/statements/${statement.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnMapping: mapping }),
      });
      const body = (await response.json()) as PreviewResponse;
      if (cancelled) return;
      if (!response.ok) {
        setError((body as { message?: string }).message ?? "Unable to preview rows.");
        return;
      }
      applyReview(body);
    })();
    return () => {
      cancelled = true;
    };
    // Auto-review on open so unmatched Groups/LOBs/Agents are visible without a hidden extra click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statement.id]);

  function setField(field: keyof ColumnMapping, value: string) {
    setMapping((current) => ({ ...current, [field]: value || null }));
    setReview(null);
  }

  function setGroupDecision(key: string, patch: Partial<GroupImportDecision>) {
    setGroupDecisions((current) => {
      const previous = current[key] ?? { key, action: "create" as const };
      return { ...current, [key]: { ...previous, ...patch, key } };
    });
  }

  function setNamedDecision(
    setter: typeof setLineDecisions,
    key: string,
    patch: Partial<NamedImportDecision>,
  ) {
    setter((current) => {
      const previous = current[key] ?? { key, action: "create" as const };
      return { ...current, [key]: { ...previous, ...patch, key } };
    });
  }

  async function confirm(path: "groups" | "lines" | "agents", decisions: object[]) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/statements/${statement.id}/${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping, decisions }),
    });
    const body = (await response.json()) as PreviewResponse;
    if (response.ok) {
      if (path === "groups") setGroups(await fetch("/api/groups").then((item) => item.json()));
      if (path === "lines") setLines(await fetch("/api/lines-of-business").then((item) => item.json()));
      if (path === "agents") setAgents(await fetch("/api/agents").then((item) => item.json()));
      applyReview(body);
    } else {
      setError((body as { message?: string }).message ?? "Unable to confirm those decisions.");
    }
    setBusy(false);
  }

  async function postReady() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/statements/${statement.id}/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to post rows.");
      return;
    }
    applyReview(body);
  }

  async function saveLayout() {
    setBusy(true);
    setError("");
    setLayoutMessage("");
    const response = await fetch(`/api/imports/statements/${statement.id}/layout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to save this statement layout.");
      return;
    }
    setLayoutMessage(body.message ?? "This statement layout was saved for later statements from this carrier.");
  }

  const unmatchedGroups = review?.unmatchedGroups ?? [];
  const unmatchedLines = review?.unmatchedLines ?? [];
  const unmatchedAgents = review?.unmatchedAgents ?? [];
  const readiness = review?.readiness ?? null;
  const continueBlocked = continueImportBlockedReason(readiness);
  const mappingFieldsToShow = mappingFields.filter((field) => !(field === "carrier" && statement.carrierName));
  const recognizedLayout = preview.pdf?.layoutName;
  const resolveActive = unmatchedGroups.length + unmatchedLines.length + unmatchedAgents.length > 0;
  const workflowStep = review?.postedCount ? "post" : review && !resolveActive && readiness?.canContinue ? "review" : review ? "resolve" : "read";

  return (
    <div className="result">
      <ol className="workflow-steps" aria-label="Statement workflow">
        <li className="done">Upload</li>
        <li className={workflowStep === "read" ? "active" : "done"}>Automatically Read</li>
        <li className={workflowStep === "resolve" ? "active" : resolveActive || review ? "done" : ""}>Confirm</li>
        <li className={workflowStep === "review" || workflowStep === "post" ? "active" : review && readiness?.canContinue ? "done" : ""}>Post</li>
      </ol>
      <strong>Confirm the extracted commission data, then post</strong>
      <p>
        Paid month is {statement.paidMonth}
        {statement.carrierName ? ` · statement carrier is ${statement.carrierName}` : ""}.
        The app already read this file and identified likely groups, coverage values, premium, and commission.
        Correct any field that looks wrong, then post.
        Recipient compensation and Agency net come from the Compensation allocation for the Group, line of business, and paid month.
      </p>
      {recognizedLayout && (
        <p><strong>Recognized carrier layout:</strong> {recognizedLayout}{preview.pdf?.layoutVersion ? ` · version ${preview.pdf.layoutVersion}` : ""}</p>
      )}
      {review && (
        <div className="blocker-summary" id="statement-blockers">
          {readiness?.canContinue ? (
            <>
              <strong>Ready to continue</strong>
              <p>Required mappings and unmatched items are resolved. Review the financial rows below, then post the ready rows.</p>
            </>
          ) : (
            <>
              <strong>Statement needs review</strong>
              <p>{continueBlocked}</p>
              {readiness?.blockers.length ? (
                <ol>
                  {readiness.blockers.map((blocker) => (
                    <li key={blocker.kind}>{blocker.message}</li>
                  ))}
                </ol>
              ) : null}
              <div className="form-actions">
                {readiness?.blockers.map((blocker) => (
                  <a key={blocker.kind} className="secondary" href={`#${blocker.targetId}`} style={{ display: "inline-block", textDecoration: "none" }}>
                    {blocker.actionLabel}
                  </a>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {statement.carrierName && (
        <div className="related-block">
          <p><strong>Carrier: {statement.carrierName}</strong></p>
          <p>Imported rows use this carrier unless a row names a different carrier.</p>
        </div>
      )}
      {!showMappingHelp && (
        <div className="form-actions" id="statement-mapping" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" disabled={busy} onClick={() => setShowMappingHelp(true)}>
            Help the app read this statement
          </button>
          <button type="button" disabled={busy || !readiness?.canContinue} onClick={postReady}>
            {review ? `Confirm and post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Confirm and post"}
          </button>
        </div>
      )}
      {showMappingHelp && (
        <>
          <p className="muted-note">Advanced recovery: choose columns only if automatic reading missed them.</p>
          {statement.carrierName && (
            <label>
              Carrier column (optional)
              <select value={mapping.carrier ?? ""} onChange={(event) => setField("carrier", event.target.value)}>
                <option value="">Use statement carrier</option>
                {headers.map((header) => (
                  <option key={header} value={header}>{header}</option>
                ))}
              </select>
            </label>
          )}
          <div className="form-grid form-grid-wide" id="statement-mapping">
            {mappingFieldsToShow.map((field) => (
              <label key={field}>
                {mappingFieldLabels[field]}
                <select value={mapping[field] ?? ""} onChange={(event) => setField(field, event.target.value)}>
                  <option value="">Not mapped</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" className="secondary" disabled={busy} onClick={runPreview}>
              {busy ? "Working…" : "Refresh extracted data"}
            </button>
            {statement.sourceType === "pdf" && statement.carrierId && (
              <button type="button" className="secondary" disabled={busy} onClick={saveLayout}>
                Save this statement layout
              </button>
            )}
            <button type="button" disabled={busy || !readiness?.canContinue} onClick={postReady}>
              {review ? `Confirm and post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Confirm and post"}
            </button>
          </div>
        </>
      )}
      {!readiness?.canContinue && <p className="form-error">{continueBlocked}</p>}
      {error && <p className="form-error">{error}</p>}
      {layoutMessage && <p className="form-success">{layoutMessage}</p>}
      {review && unmatchedGroups.length > 0 && (
        <ResolveTable
          id="resolve-groups"
          title={`${unmatchedGroups.length} Group${unmatchedGroups.length === 1 ? "" : "s"} need review`}
          help="These names are not on file. They stay as Create New Group unless you match one to an existing group. Nothing is created until you confirm. Creating a group does not create compensation or assignments."
          rows={unmatchedGroups.map((group) => ({
            key: group.key,
            label: group.sourceName || group.sourceNumber || group.key,
            detail: group.sourceName && group.sourceNumber ? group.sourceNumber : null,
            rowCount: group.rowCount,
            decision: groupDecisions[group.key] ?? { key: group.key, action: "create" as const },
          }))}
          options={groups.map((option) => ({ id: option.id, label: `${option.name}${option.groupNumber ? ` · ${option.groupNumber}` : ""}` }))}
          createLabel="Create new group"
          matchLabel="Match existing group"
          confirmLabel="Confirm group decisions"
          busy={busy}
          onDecision={(key, action, existingId) => setGroupDecision(key, { action: action as "create" | "match", existingGroupId: existingId ?? null })}
          onConfirm={() => confirm("groups", Object.values(groupDecisions))}
        />
      )}
      {review && unmatchedLines.length > 0 && (
        <ResolveTable
          id="resolve-lines"
          title={`${unmatchedLines.length} Line${unmatchedLines.length === 1 ? "" : "s"} of Business need review`}
          help="Carrier product labels that do not match a line of business stay unmatched until you confirm. Confirming a coverage value for this carrier is reused on later statements from the same carrier only. Changing it later does not rewrite posted commissions. Creating a line of business does not create a compensation agreement."
          rows={unmatchedLines.map((line) => ({
            key: line.key,
            label: line.sourceName,
            detail: null,
            rowCount: line.rowCount,
            decision: lineDecisions[line.key] ?? { key: line.key, action: "create" as const },
          }))}
          options={lines.map((option) => ({ id: option.id, label: option.name }))}
          createLabel="Create new line of business"
          matchLabel="Match existing line of business"
          confirmLabel="Confirm line of business decisions"
          busy={busy}
          onDecision={(key, action, existingId) => setNamedDecision(setLineDecisions, key, { action, existingId: existingId ?? null })}
          onConfirm={() => confirm("lines", Object.values(lineDecisions))}
        />
      )}
      {review && unmatchedAgents.length > 0 && (
        <ResolveTable
          id="resolve-agents"
          title={`${unmatchedAgents.length} Agent${unmatchedAgents.length === 1 ? "" : "s"} need review`}
          help="An unmatched producer name is not created until you confirm. Creating an agent does not create a split, compensation agreement, or account manager assignment."
          rows={unmatchedAgents.map((agent) => ({
            key: agent.key,
            label: agent.sourceName,
            detail: null,
            rowCount: agent.rowCount,
            decision: agentDecisions[agent.key] ?? { key: agent.key, action: "create" as const },
          }))}
          options={agents.map((option) => ({ id: option.id, label: option.name }))}
          createLabel="Create agent"
          matchLabel="Match existing agent"
          confirmLabel="Confirm agent decisions"
          busy={busy}
          onDecision={(key, action, existingId) => setNamedDecision(setAgentDecisions, key, { action, existingId: existingId ?? null })}
          onConfirm={() => confirm("agents", Object.values(agentDecisions))}
        />
      )}
      {review && (
        <>
          {review.createdCount ? <p className="form-success">Saved {review.createdCount} confirmed record{review.createdCount === 1 ? "" : "s"}. No compensation was created.</p> : null}
          {review.conflicts?.map((conflict) => <p key={conflict} className="form-error">{conflict}</p>)}
          {review.postedCount > 0 && <p className="form-success">Posted rows are now commission records. Reopening this statement will not post them twice.</p>}
          <div id="statement-rows">
            <p>
              {review.readyCount} ready · {review.blockedCount} blocked · {review.postedCount} already posted
              {" "}· paid month {statement.paidMonth}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Group</th>
                  <th>Carrier</th>
                  <th>Line</th>
                  <th>Agent</th>
                  <th>Premium</th>
                  <th>Gross</th>
                  <th>Compensation</th>
                  <th>Agency net</th>
                  <th>Coverage month</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => {
                  const distributed = row.compensationDistributedCents
                    ?? (row.grossCommissionCents == null ? null : calculateAgentCompensationCents(row.grossCommissionCents, row.compensationBps ?? 0));
                  const agencyNet = row.agencyNetCents
                    ?? (row.grossCommissionCents == null || distributed == null ? null : calculateAgencyNetCents(row.grossCommissionCents, distributed));
                  return (
                    <tr key={row.sourceRowKey}>
                      <td>{row.rowNumber}</td>
                      <td>{row.groupLabel || "—"}</td>
                      <td>
                        {row.carrierLabel || "—"}
                        {row.carrierSource === "statement" ? <small> · statement carrier</small> : null}
                      </td>
                      <td>{row.lineOfBusinessLabel || "—"}</td>
                      <td>{row.agentLabel || "Unassigned"}</td>
                      <td>{row.premiumCents == null ? "—" : formatCents(row.premiumCents)}</td>
                      <td>{row.grossCommissionCents == null ? "—" : formatCents(row.grossCommissionCents)}</td>
                      <td>{distributed == null ? "—" : formatCents(distributed)}</td>
                      <td>{agencyNet == null ? "—" : formatCents(agencyNet)}</td>
                      <td>{row.premiumMonth || "—"}</td>
                      <td>
                        <span className={`pill ${row.status === "ready" ? "ready_to_map" : row.status === "posted" ? "posted" : "review"}`}>
                          {row.status}
                        </span>
                        {row.exceptions.length > 0 && <small> {row.exceptions.join(" ")}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ResolveTable({
  id,
  title,
  help,
  rows,
  options,
  createLabel,
  matchLabel,
  confirmLabel,
  busy,
  onDecision,
  onConfirm,
}: {
  id: string;
  title: string;
  help: string;
  rows: Array<{ key: string; label: string; detail: string | null; rowCount: number; decision: { action: "create" | "match" } }>;
  options: Array<{ id: number; label: string }>;
  createLabel: string;
  matchLabel: string;
  confirmLabel: string;
  busy: boolean;
  onDecision: (key: string, action: "create" | "match", existingId?: number | null) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="related-block" id={id}>
      <strong>{title}</strong>
      <p>{help}</p>
      <table>
        <thead>
          <tr>
            <th>Statement value</th>
            <th>Rows</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const decision = row.decision;
            return (
              <tr key={row.key}>
                <td>
                  <strong>{row.label}</strong>
                  {row.detail ? <small> · {row.detail}</small> : null}
                </td>
                <td>{row.rowCount}</td>
                <td>
                  <div className="form-actions">
                    <select
                      aria-label={`Decision for ${row.label}`}
                      value={decision.action}
                      onChange={(event) => onDecision(row.key, event.target.value as "create" | "match", null)}
                    >
                      <option value="create">{createLabel}</option>
                      <option value="match">{matchLabel}</option>
                    </select>
                    {decision.action === "match" && (
                      <select
                        aria-label={`Existing record for ${row.label}`}
                        value={"existingId" in decision ? String((decision as NamedImportDecision).existingId ?? "") : String((decision as GroupImportDecision).existingGroupId ?? "")}
                        onChange={(event) => onDecision(row.key, "match", event.target.value ? Number(event.target.value) : null)}
                      >
                        <option value="">Select a record</option>
                        {options.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? "Saving…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}
