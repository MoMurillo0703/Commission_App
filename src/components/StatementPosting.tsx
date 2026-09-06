"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImportStatementView } from "@/data/statements";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";
import { collectPreviewHeaders, mappingFieldLabels, mappingFields, mappingLooksAutomatic, omitStatementCompensationMapping, suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import type { UnmatchedImportGroup, GroupImportDecision } from "@/domain/importGroups";
import { partitionStatementGroupAssignments } from "@/domain/groupAssignment";
import { defaultGroupImportAction, groupMatchesQuery, suggestGroupCandidates, type GroupSuggestion } from "@/domain/groupMatch";
import type { ValidatedImportRow } from "@/domain/importRows";
import { formatCents } from "@/domain/money";
import type { NamedImportDecision, UnmatchedNamedImport } from "@/domain/namedImport";
import { continueImportBlockedReason, isStatementFullyPosted, type StatementReadiness } from "@/domain/statementReadiness";
import type { StatementPreview } from "@/domain/workbook";

type NamedOption = { id: number; name: string; groupNumber?: string | null; accountManagerId?: number | null; primaryAgentId?: number | null };

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

function intakeMapping(mapping: ColumnMapping, extractedConfirm: boolean): ColumnMapping {
  if (!extractedConfirm) return normalizeSpreadsheetMapping(mapping);
  return omitStatementCompensationMapping(mapping);
}

function normalizeSpreadsheetMapping(mapping: ColumnMapping): ColumnMapping {
  const { compensationPercent: _split, ...rest } = mapping;
  return rest;
}

export function StatementPosting({
  statement,
  preview,
  variant = "spreadsheet",
}: {
  statement: ImportStatementView;
  preview: StatementPreview;
  variant?: "spreadsheet" | "extracted-confirm";
}) {
  const headers = useMemo(() => collectPreviewHeaders(preview.sheets), [preview.sheets]);
  const [mapping, setMapping] = useState<ColumnMapping>(
    intakeMapping(statement.columnMapping ?? suggestColumnMapping(headers), variant === "extracted-confirm"),
  );
  const [review, setReview] = useState<PreviewResponse | null>(null);
  const [groups, setGroups] = useState<NamedOption[]>([]);
  const [accountManagers, setAccountManagers] = useState<NamedOption[]>([]);
  const [lines, setLines] = useState<NamedOption[]>([]);
  const [agents, setAgents] = useState<NamedOption[]>([]);
  const [groupDecisions, setGroupDecisions] = useState<Record<string, GroupImportDecision>>({});
  const [lineDecisions, setLineDecisions] = useState<Record<string, NamedImportDecision>>({});
  const [agentDecisions, setAgentDecisions] = useState<Record<string, NamedImportDecision>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const extractedConfirm = variant === "extracted-confirm";
  const postingMapping = intakeMapping(mapping, extractedConfirm);
  const [showMappingHelp, setShowMappingHelp] = useState(() => (
    extractedConfirm
      ? false
      : !mappingLooksAutomatic(statement.columnMapping ?? suggestColumnMapping(headers))
  ));

  useEffect(() => {
    void Promise.all([
      fetchWithDeadline("/api/groups").then(async (response) => { if (response.ok) setGroups(await readApiJson<NamedOption[]>(response)); }),
      fetchWithDeadline("/api/account-managers").then(async (response) => { if (response.ok) setAccountManagers(await readApiJson<NamedOption[]>(response)); }),
      fetchWithDeadline("/api/lines-of-business").then(async (response) => { if (response.ok) setLines(await readApiJson<NamedOption[]>(response)); }),
      fetchWithDeadline("/api/agents").then(async (response) => { if (response.ok) setAgents(await readApiJson<NamedOption[]>(response)); }),
    ]);
  }, []);

  useEffect(() => {
    if (!review || groups.length === 0) return;
    setGroupDecisions((current) => {
      const next = { ...current };
      for (const group of review.unmatchedGroups ?? []) {
        const existing = next[group.key];
        if (existing && existing.action !== "create") continue;
        const suggested = defaultGroupImportAction(groups, group.sourceName, group.sourceNumber);
        if (suggested.action === "match") {
          next[group.key] = { key: group.key, action: "match", existingGroupId: suggested.existingGroupId };
        }
      }
      return next;
    });
  }, [groups, review]);

  function applyReview(body: PreviewResponse, groupOptions = groups) {
    setReview(body);
    setGroupDecisions(Object.fromEntries((body.unmatchedGroups ?? []).map((group) => {
      const suggested = defaultGroupImportAction(groupOptions, group.sourceName, group.sourceNumber);
      return [group.key, {
        key: group.key,
        action: suggested.action,
        existingGroupId: suggested.existingGroupId,
      }];
    })));
    setLineDecisions(defaultNamedDecisions(body.unmatchedLines ?? []));
    setAgentDecisions(defaultNamedDecisions(body.unmatchedAgents ?? []));
    if (variant !== "extracted-confirm" && body.readiness?.blockers.some((blocker) => blocker.kind === "mapping")) {
      setShowMappingHelp(true);
    }
  }

  async function runPreview() {
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: postingMapping }),
        });
        const body = await readApiJson<PreviewResponse>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        applyReview(body);
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to preview rows."));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: postingMapping }),
        });
        const body = await readApiJson<PreviewResponse>(response);
        if (cancelled) return;
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        applyReview(body);
      } catch (error) {
        if (!cancelled) setError(requestFailureMessage(error, "Unable to preview rows."));
      }
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
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/${path}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: postingMapping, decisions }),
        });
        const body = await readApiJson<PreviewResponse>(response);
        if (response.ok) {
          if (path === "groups") {
            const listed = await fetchWithDeadline("/api/groups");
            if (listed.ok) setGroups(await readApiJson<NamedOption[]>(listed));
          }
          if (path === "lines") {
            const listed = await fetchWithDeadline("/api/lines-of-business");
            if (listed.ok) setLines(await readApiJson<NamedOption[]>(listed));
          }
          if (path === "agents") {
            const listed = await fetchWithDeadline("/api/agents");
            if (listed.ok) setAgents(await readApiJson<NamedOption[]>(listed));
          }
          applyReview(body);
        } else {
          setError(httpFailureMessage(response.status, body.message));
        }
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to confirm those decisions."));
    }
  }

  async function postReady() {
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/post`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: postingMapping }),
        });
        const body = await readApiJson<PreviewResponse>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        applyReview(body);
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to post rows."));
    }
  }

  async function saveLayout() {
    setError("");
    setLayoutMessage("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/layout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columnMapping: postingMapping }),
        });
        const body = await readApiJson<{ message?: string }>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        setLayoutMessage(body.message ?? "This statement layout was saved for later statements from this carrier.");
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to save this statement layout."));
    }
  }

  const unmatchedGroups = review?.unmatchedGroups ?? [];
  const unmatchedLines = review?.unmatchedLines ?? [];
  const unmatchedAgents = review?.unmatchedAgents ?? [];
  const readiness = review?.readiness ?? null;
  const continueBlocked = continueImportBlockedReason(readiness);
  const fullyPosted = isStatementFullyPosted(readiness) && unmatchedGroups.length + unmatchedLines.length + unmatchedAgents.length === 0;
  const mappingFieldsToShow = mappingFields.filter((field) => !(field === "carrier" && statement.carrierName));
  const showCarrierMapping = extractedConfirm ? false : !statement.carrierName;
  const recognizedLayout = preview.pdf?.layoutName;
  const resolveActive = unmatchedGroups.length + unmatchedLines.length + unmatchedAgents.length > 0;
  const workflowStep = fullyPosted || review?.postedCount ? "post" : review && !resolveActive && readiness?.canContinue ? "review" : review ? "resolve" : "read";

  return (
    <div className="result">
      <ol className="workflow-steps" aria-label="Statement workflow">
        <li className="done">Upload</li>
        <li className={workflowStep === "read" ? "active" : "done"}>Automatically Read</li>
        <li className={workflowStep === "resolve" ? "active" : resolveActive || review ? "done" : ""}>Confirm</li>
        <li className={workflowStep === "review" || workflowStep === "post" ? "active" : review && readiness?.canContinue ? "done" : ""}>Post</li>
      </ol>
      <strong>
        {extractedConfirm
          ? `We found ${review?.rows.length ?? preview.rowCount} commission record${(review?.rows.length ?? preview.rowCount) === 1 ? "" : "s"}`
          : "Confirm the extracted commission data, then post"}
      </strong>
      <p>
        Paid month is {statement.paidMonth}
        {statement.carrierName ? ` · statement carrier is ${statement.carrierName}` : ""}.
        {extractedConfirm
          ? " Review what the app read. Correct only exceptions, then confirm and post. Compensation comes from the Group + line of business allocation for this paid month, not from this statement."
          : " The app already read this file and identified likely groups, coverage values, premium, and commission. Correct any field that looks wrong, then post. Recipient compensation comes from the Compensation allocation, not from statement columns."}
      </p>
      {recognizedLayout && (
        <p><strong>Recognized carrier layout:</strong> {recognizedLayout}{preview.pdf?.layoutVersion ? ` · version ${preview.pdf.layoutVersion}` : ""}</p>
      )}
      {review && (
        <div className="blocker-summary" id="statement-blockers">
          {fullyPosted ? (
            <>
              <strong>Statement posted</strong>
              <p>
                All rows from this file are already posted commission records. The original statement remains available.
                Reopening this statement will not post them twice.
              </p>
              <div className="form-actions">
                <a className="secondary" href={`/api/imports/statements/${statement.id}/file`} style={{ display: "inline-block", textDecoration: "none" }}>
                  Download original statement
                </a>
                <a className="secondary" href="/compensation" style={{ display: "inline-block", textDecoration: "none" }}>
                  Confirm compensation
                </a>
                <a className="secondary" href="/reports" style={{ display: "inline-block", textDecoration: "none" }}>
                  Recipient statement
                </a>
              </div>
            </>
          ) : readiness?.canContinue ? (
            <>
              <strong>{extractedConfirm ? "Ready to confirm" : "Ready to continue"}</strong>
              <p>{extractedConfirm ? "The extracted records are ready. Confirm and post the ready rows." : "Required mappings and unmatched items are resolved. Review the financial rows below, then post the ready rows."}</p>
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
          <p>This statement uses the selected carrier. A Carrier column is not needed unless the file contains more than one carrier.</p>
        </div>
      )}
      {!showMappingHelp && !fullyPosted && (
        <div className="form-actions" id="statement-mapping" style={{ marginTop: 12 }}>
          <button type="button" className="secondary" disabled={busy} onClick={() => setShowMappingHelp(true)}>
            Help the app read this statement
          </button>
          <button type="button" disabled={busy || !readiness?.canContinue} onClick={postReady}>
            {review ? `Confirm & Post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Confirm & Post"}
          </button>
        </div>
      )}
      {showMappingHelp && (
        <>
          <p className="muted-note">Advanced recovery: choose columns only if automatic reading missed them.</p>
          {showCarrierMapping && (
            <label>
              Carrier column
              <select value={mapping.carrier ?? ""} onChange={(event) => setField("carrier", event.target.value)}>
                <option value="">Not mapped</option>
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
            {!fullyPosted && (
              <button type="button" disabled={busy || !readiness?.canContinue} onClick={postReady}>
                {review ? `Confirm & Post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Confirm & Post"}
              </button>
            )}
          </div>
        </>
      )}
      {!fullyPosted && !readiness?.canContinue && continueBlocked && <p className="form-error">{continueBlocked}</p>}
      {error && <p className="form-error">{error}</p>}
      {layoutMessage && <p className="form-success">{layoutMessage}</p>}
      {review && unmatchedGroups.length > 0 && (
        <ResolveTable
          id="resolve-groups"
          title={`${unmatchedGroups.length} Group${unmatchedGroups.length === 1 ? "" : "s"} need review`}
          help="These names are not on file. Search to match an existing group, create a new group, or ignore. A suggested match is never applied until you confirm. Ignore skips posting those rows and does not create a group. Creating a group does not create compensation or assignments."
          rows={unmatchedGroups.map((group) => ({
            key: group.key,
            label: group.sourceName || group.sourceNumber || group.key,
            detail: group.sourceName && group.sourceNumber ? group.sourceNumber : null,
            rowCount: group.rowCount,
            decision: groupDecisions[group.key] ?? { key: group.key, action: "create" as const },
            suggestions: suggestGroupCandidates(groups, group.sourceName, group.sourceNumber),
          }))}
          options={groups.map((option) => ({ id: option.id, label: `${option.name}${option.groupNumber ? ` · ${option.groupNumber}` : ""}`, name: option.name, groupNumber: option.groupNumber }))}
          createLabel="Create new group"
          matchLabel="Match existing group"
          ignoreLabel="Ignore"
          confirmLabel="Confirm group decisions"
          searchable
          busy={busy}
          onDecision={(key, action, existingId) => setGroupDecision(key, { action: action as "create" | "match" | "ignore", existingGroupId: existingId ?? null })}
          onConfirm={() => confirm("groups", Object.values(groupDecisions))}
        />
      )}
      {review && unmatchedLines.length > 0 && (
        <ResolveTable
          id="resolve-lines"
          title={`${unmatchedLines.length} Line${unmatchedLines.length === 1 ? "" : "s"} of Business need review`}
          help="Carrier product labels that do not match a line of business stay unmatched until you confirm. Match or create a line of business, or ignore. Ignore skips posting those rows and does not create a line of business or compensation. Confirming a coverage value for this carrier is reused on later statements from the same carrier only. Changing it later does not rewrite posted commissions."
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
          ignoreLabel="Ignore"
          confirmLabel="Confirm line of business decisions"
          busy={busy}
          onDecision={(key, action, existingId) => {
            setNamedDecision(setLineDecisions, key, { action, existingId: existingId ?? null });
          }}
          onConfirm={() => confirm("lines", Object.values(lineDecisions))}
        />
      )}
      {review && !extractedConfirm && unmatchedAgents.length > 0 && (
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
          onDecision={(key, action, existingId) => {
            if (action === "ignore") return;
            setNamedDecision(setAgentDecisions, key, { action, existingId: existingId ?? null });
          }}
          onConfirm={() => confirm("agents", Object.values(agentDecisions))}
        />
      )}
      {review && (
        <>
          {review.createdCount ? <p className="form-success">Saved {review.createdCount} confirmed record{review.createdCount === 1 ? "" : "s"}. No compensation was created.</p> : null}
          {review.conflicts?.map((conflict) => <p key={conflict} className="form-error">{conflict}</p>)}
          {review.postedCount > 0 && !fullyPosted && <p className="form-success">Posted rows are now commission records. Reopening this statement will not post them twice.</p>}
          <StatementGroupAssignment
            rows={review.rows}
            groups={groups}
            agents={agents}
            accountManagers={accountManagers}
            busy={busy}
            onGroupsChange={setGroups}
            onBusy={setBusy}
            onError={setError}
          />
          <div id="statement-rows">
            <p>
              {review.readyCount} ready · {review.blockedCount} {extractedConfirm ? "needs review" : "blocked"} · {review.postedCount} already posted
              {" "}· paid month {statement.paidMonth}
            </p>
            <table>
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Group #</th>
                  {extractedConfirm ? null : <th>Carrier</th>}
                  <th>Coverage</th>
                  <th>Premium</th>
                  <th>Commission</th>
                  <th>Coverage month</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {review.rows.map((row) => {
                  const statusLabel = row.status === "ready" ? "READY" : row.status === "posted" ? "POSTED" : row.status === "ignored" ? "IGNORED" : row.exceptions.some((item) => /Unmatched|Ambiguous/.test(item)) ? "NEEDS REVIEW" : "BLOCKED";
                  return (
                    <tr key={row.sourceRowKey}>
                      <td>{row.groupLabel || row.importedGroupName || "—"}</td>
                      <td>{row.importedGroupNumber || "—"}</td>
                      {extractedConfirm ? null : (
                        <td>
                          {row.carrierLabel || "—"}
                          {row.carrierSource === "statement" ? <small> · statement carrier</small> : null}
                        </td>
                      )}
                      <td>{row.lineOfBusinessLabel || row.importedLineName || "—"}</td>
                      <td>{row.premiumCents == null ? "—" : formatCents(row.premiumCents)}</td>
                      <td>{row.grossCommissionCents == null ? "—" : formatCents(row.grossCommissionCents)}</td>
                      <td>{row.premiumMonth || "—"}</td>
                      <td>
                        <span className={`pill ${row.status === "ready" ? "ready_to_map" : row.status === "posted" ? "posted" : row.status === "ignored" ? "review" : "review"}`}>
                          {statusLabel}
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

function StatementGroupAssignment({
  rows,
  groups,
  agents,
  accountManagers,
  busy,
  onGroupsChange,
  onBusy,
  onError,
}: {
  rows: ValidatedImportRow[];
  groups: NamedOption[];
  agents: NamedOption[];
  accountManagers: NamedOption[];
  busy: boolean;
  onGroupsChange: (groups: NamedOption[]) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string) => void;
}) {
  const statementGroups = useMemo(() => {
    const ids = [...new Set(rows.flatMap((row) => row.groupId == null ? [] : [row.groupId]))];
    return ids
      .map((id) => groups.find((group) => group.id === id))
      .filter((group): group is NamedOption => Boolean(group));
  }, [groups, rows]);
  const { assigned: assignedGroups, needsAssignment } = partitionStatementGroupAssignments(statementGroups);
  const [drafts, setDrafts] = useState<Record<number, { accountManagerId: string; primaryAgentId: string }>>({});
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [saved, setSaved] = useState("");
  const [bulkManagerId, setBulkManagerId] = useState("");
  const [bulkAgentId, setBulkAgentId] = useState("");

  useEffect(() => {
    const missing = partitionStatementGroupAssignments(statementGroups).needsAssignment;
    setDrafts(Object.fromEntries(missing.map((group) => [group.id, {
      accountManagerId: group.accountManagerId ? String(group.accountManagerId) : "",
      primaryAgentId: group.primaryAgentId ? String(group.primaryAgentId) : "",
    }])));
    setSelected((current) => Object.fromEntries(missing.map((group) => [group.id, current[group.id] ?? true])));
  }, [statementGroups]);

  if (statementGroups.length === 0) return null;

  async function refreshGroups() {
    const listed = await fetchWithDeadline("/api/groups");
    if (listed.ok) onGroupsChange(await readApiJson<NamedOption[]>(listed));
  }

  async function saveAssignments(targets: NamedOption[]) {
    onError("");
    setSaved("");
    try {
      await runBusyAction(onBusy, async () => {
        for (const group of targets) {
          const draft = drafts[group.id] ?? { accountManagerId: "", primaryAgentId: "" };
          const response = await fetchWithDeadline(`/api/groups/${group.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: group.name,
              groupNumber: group.groupNumber ?? null,
              accountManagerId: draft.accountManagerId ? Number(draft.accountManagerId) : null,
              primaryAgentId: draft.primaryAgentId ? Number(draft.primaryAgentId) : null,
            }),
          });
          const body = await readApiJson<{ message?: string }>(response);
          if (!response.ok) {
            onError(httpFailureMessage(response.status, body.message));
            return;
          }
        }
        await refreshGroups();
        setSaved(`Saved assignments for ${targets.length} group${targets.length === 1 ? "" : "s"}. Assignment does not create compensation and does not block posting.`);
      });
    } catch (error) {
      onError(requestFailureMessage(error, "Unable to save group assignment."));
    }
  }

  function applyToSelected() {
    const ids = needsAssignment.filter((group) => selected[group.id]);
    setDrafts((current) => {
      const next = { ...current };
      for (const group of ids) {
        next[group.id] = {
          accountManagerId: bulkManagerId || current[group.id]?.accountManagerId || "",
          primaryAgentId: bulkAgentId || current[group.id]?.primaryAgentId || "",
        };
      }
      return next;
    });
  }

  const selectedNeeds = needsAssignment.filter((group) => selected[group.id]);

  return (
    <div className="related-block" id="statement-group-assignment">
      <strong>Group assignments</strong>
      <p>
        Assignments belong to the Group. Missing Account Manager or Primary Agent does not block posting.
        Confirm Group + line of business splits on <a href="/compensation">Compensation</a>.
      </p>
      {assignedGroups.length > 0 && (
        <p className="muted-note">
          {assignedGroups.length} group{assignedGroups.length === 1 ? " already has" : "s already have"} saved assignments
          {assignedGroups.length <= 8 ? `: ${assignedGroups.map((group) => group.name).join(", ")}` : ""}.
        </p>
      )}
      {needsAssignment.length === 0 ? (
        <p className="form-success">No groups on this statement still need assignment.</p>
      ) : (
        <>
          <div className="form-actions" style={{ margin: "10px 0", flexWrap: "wrap" }}>
            <select aria-label="Apply account manager to selected groups" value={bulkManagerId} onChange={(event) => setBulkManagerId(event.target.value)}>
              <option value="">Account manager for selected</option>
              {accountManagers.map((manager) => (
                <option key={manager.id} value={manager.id}>{manager.name}</option>
              ))}
            </select>
            <select aria-label="Apply primary agent to selected groups" value={bulkAgentId} onChange={(event) => setBulkAgentId(event.target.value)}>
              <option value="">Primary agent for selected</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
            <button type="button" className="secondary" disabled={busy || selectedNeeds.length === 0} onClick={applyToSelected}>
              Apply to selected
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all groups needing assignment"
                    checked={needsAssignment.length > 0 && needsAssignment.every((group) => selected[group.id])}
                    onChange={(event) => setSelected(Object.fromEntries(needsAssignment.map((group) => [group.id, event.target.checked])))}
                  />
                </th>
                <th>Group</th>
                <th>Account Manager</th>
                <th>Primary Agent</th>
              </tr>
            </thead>
            <tbody>
              {needsAssignment.map((group) => {
                const draft = drafts[group.id] ?? { accountManagerId: "", primaryAgentId: "" };
                return (
                  <tr key={group.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${group.name}`}
                        checked={Boolean(selected[group.id])}
                        onChange={(event) => setSelected((current) => ({ ...current, [group.id]: event.target.checked }))}
                      />
                    </td>
                    <td>
                      <strong>{group.name}</strong>
                      {group.groupNumber ? <small> · {group.groupNumber}</small> : null}
                    </td>
                    <td>
                      <select
                        aria-label={`Account manager for ${group.name}`}
                        value={draft.accountManagerId}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [group.id]: { ...draft, accountManagerId: event.target.value },
                        }))}
                      >
                        <option value="">Unassigned</option>
                        {accountManagers.map((manager) => (
                          <option key={manager.id} value={manager.id}>{manager.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`Primary agent for ${group.name}`}
                        value={draft.primaryAgentId}
                        onChange={(event) => setDrafts((current) => ({
                          ...current,
                          [group.id]: { ...draft, primaryAgentId: event.target.value },
                        }))}
                      >
                        <option value="">Unassigned</option>
                        {agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" disabled={busy || needsAssignment.length === 0} onClick={() => void saveAssignments(needsAssignment)}>
              {busy ? "Saving…" : "Save all assignments"}
            </button>
            <button type="button" className="secondary" disabled={busy || selectedNeeds.length === 0} onClick={() => void saveAssignments(selectedNeeds)}>
              Save selected
            </button>
          </div>
        </>
      )}
      {saved && <p className="form-success">{saved}</p>}
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
  ignoreLabel,
  confirmLabel,
  searchable,
  busy,
  onDecision,
  onConfirm,
}: {
  id: string;
  title: string;
  help: string;
  rows: Array<{
    key: string;
    label: string;
    detail: string | null;
    rowCount: number;
    decision: { action: "create" | "match" | "ignore" };
    suggestions?: GroupSuggestion[];
  }>;
  options: Array<{ id: number; label: string; name?: string; groupNumber?: string | null }>;
  createLabel: string;
  matchLabel: string;
  ignoreLabel?: string;
  confirmLabel: string;
  searchable?: boolean;
  busy: boolean;
  onDecision: (key: string, action: "create" | "match" | "ignore", existingId?: number | null) => void;
  onConfirm: () => void;
}) {
  const [queries, setQueries] = useState<Record<string, string>>({});
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
            const selectedId = "existingId" in decision
              ? String((decision as NamedImportDecision).existingId ?? "")
              : String((decision as GroupImportDecision).existingGroupId ?? "");
            const query = queries[row.key] ?? "";
            const filtered = searchable
              ? options.filter((option) => groupMatchesQuery({ name: option.name ?? option.label, groupNumber: option.groupNumber ?? null }, query))
              : options;
            const suggestions = row.suggestions ?? [];
            return (
              <tr key={row.key}>
                <td>
                  <strong>{row.label}</strong>
                  {row.detail ? <small> · {row.detail}</small> : null}
                  {suggestions.filter((item) => item.strong).map((item) => (
                    <div key={item.id}>
                      <small>Suggested match: {item.name}{item.groupNumber ? ` · ${item.groupNumber}` : ""} ({item.reason})</small>
                    </div>
                  ))}
                </td>
                <td>{row.rowCount}</td>
                <td>
                  <div className="form-actions" style={{ flexWrap: "wrap" }}>
                    <select
                      aria-label={`Decision for ${row.label}`}
                      value={decision.action}
                      onChange={(event) => onDecision(row.key, event.target.value as "create" | "match" | "ignore", null)}
                    >
                      <option value="create">{createLabel}</option>
                      <option value="match">{matchLabel}</option>
                      {ignoreLabel && <option value="ignore">{ignoreLabel}</option>}
                    </select>
                    {decision.action === "match" && (
                      <>
                        {searchable && (
                          <input
                            aria-label={`Search existing records for ${row.label}`}
                            placeholder="Search name or number"
                            value={query}
                            onChange={(event) => setQueries((current) => ({ ...current, [row.key]: event.target.value }))}
                          />
                        )}
                        <select
                          aria-label={`Existing record for ${row.label}`}
                          value={selectedId}
                          onChange={(event) => onDecision(row.key, "match", event.target.value ? Number(event.target.value) : null)}
                        >
                          <option value="">Select a record</option>
                          {suggestions.length > 0 && (
                            <optgroup label="Suggested">
                              {suggestions.map((item) => (
                                <option key={`suggested-${item.id}`} value={item.id}>{item.name}{item.groupNumber ? ` · ${item.groupNumber}` : ""}</option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label={searchable ? "Search results" : "All records"}>
                            {filtered.map((option) => (
                              <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                          </optgroup>
                        </select>
                      </>
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
