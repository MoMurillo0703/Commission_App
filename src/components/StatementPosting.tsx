"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImportStatementView } from "@/data/statements";
import { collectPreviewHeaders, mappingFieldLabels, mappingFields, suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import type { UnmatchedImportGroup, GroupImportDecision } from "@/domain/importGroups";
import type { ValidatedImportRow } from "@/domain/importRows";
import { formatCents } from "@/domain/money";
import type { StatementPreview } from "@/domain/workbook";

type PreviewResponse = {
  paidMonth: string;
  rows: ValidatedImportRow[];
  readyCount: number;
  blockedCount: number;
  postedCount: number;
  unmatchedGroups?: UnmatchedImportGroup[];
  createdCount?: number;
  reusedCount?: number;
  matchedCount?: number;
  conflicts?: string[];
  remainingUnmatchedCount?: number;
  message?: string;
};

type GroupOption = { id: number; name: string; groupNumber: string | null };

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
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [decisions, setDecisions] = useState<Record<string, GroupImportDecision>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/groups").then(async (response) => {
      if (response.ok) setGroups(await response.json());
    });
  }, []);

  function setField(field: keyof ColumnMapping, value: string) {
    setMapping((current) => ({ ...current, [field]: value || null }));
    setReview(null);
  }

  function setDecision(key: string, patch: Partial<GroupImportDecision>) {
    setDecisions((current) => {
      const previous = current[key] ?? { key, action: "create" as const };
      return { ...current, [key]: { ...previous, ...patch, key } };
    });
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
    const unmatched = body.unmatchedGroups ?? [];
    setReview({ ...body, unmatchedGroups: unmatched });
    setDecisions(Object.fromEntries(unmatched.map((group) => [group.key, { key: group.key, action: "create" }])));
  }

  async function confirmGroups() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/statements/${statement.id}/groups`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping, decisions: Object.values(decisions) }),
    });
    const body = (await response.json()) as PreviewResponse;
    if (response.ok) {
      const nextGroups = await fetch("/api/groups").then((item) => item.json());
      setGroups(nextGroups);
      setReview(body);
      setDecisions(Object.fromEntries((body.unmatchedGroups ?? []).map((group) => [group.key, { key: group.key, action: "create" }])));
    } else {
      setError((body as { message?: string }).message ?? "Unable to confirm groups.");
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
    setReview(body);
  }

  const unmatched = review?.unmatchedGroups ?? [];
  const mappingFieldsToShow = mappingFields.filter((field) => !(field === "carrier" && statement.carrierName));

  return (
    <div className="result">
      <ol className="workflow-steps" aria-label="Statement workflow">
        <li className="done">Upload</li><li className="done">Read</li><li className={review ? "done" : "active"}>Review</li><li className={review?.postedCount ? "done" : ""}>Post</li>
      </ol>
      <strong>Review anything the app could not determine, then continue the import</strong>
      <p>
        Paid month is {statement.paidMonth}
        {statement.carrierName ? ` · statement carrier is ${statement.carrierName}` : ""}.
        Premium / coverage month stays on the row when mapped.
        {statement.carrierName
          ? " Map a Carrier column only if this file contains more than one carrier."
          : " Map a Carrier column for each row."}
      </p>
      {statement.carrierName && (
        <div className="related-block">
          <p><strong>Carrier: {statement.carrierName}</strong></p>
          <p>Source: Statement carrier. Imported rows use this carrier unless a row-level Carrier column is mapped.</p>
          <label>
            Carrier column (optional)
            <select value={mapping.carrier ?? ""} onChange={(event) => setField("carrier", event.target.value)}>
              <option value="">Use statement carrier</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="form-grid form-grid-wide">
        {mappingFieldsToShow.map((field) => (
          <label key={field}>
            {mappingFieldLabels[field]}
            <select value={mapping[field] ?? ""} onChange={(event) => setField(field, event.target.value)}>
              <option value="">Not mapped</option>
              {headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 12 }}>
        <button type="button" className="secondary" disabled={busy} onClick={runPreview}>
          {busy ? "Working…" : "Review Statement"}
        </button>
        <button type="button" disabled={busy || !review || unmatched.length > 0 || review.readyCount === 0} onClick={postReady}>
          {review ? `Continue Import · post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Continue Import"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {review && unmatched.length > 0 && (
        <div className="related-block">
          <strong>{unmatched.length} new group{unmatched.length === 1 ? "" : "s"} found</strong>
          <p>These names are not on file. They stay as Create New Group unless you match one to an existing group. Nothing is created until you confirm.</p>
          <table>
            <thead>
              <tr>
                <th>Statement group</th>
                <th>Rows</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((group) => {
                const decision = decisions[group.key] ?? { key: group.key, action: "create" as const };
                return (
                  <tr key={group.key}>
                    <td>
                      <strong>{group.sourceName || group.sourceNumber}</strong>
                      {group.sourceName && group.sourceNumber ? <small> · {group.sourceNumber}</small> : null}
                    </td>
                    <td>{group.rowCount}</td>
                    <td>
                      <div className="form-actions">
                        <select
                          aria-label={`Decision for ${group.sourceName || group.sourceNumber}`}
                          value={decision.action}
                          onChange={(event) => setDecision(group.key, { action: event.target.value as "create" | "match", existingGroupId: null })}
                        >
                          <option value="create">Create new group</option>
                          <option value="match">Match existing group</option>
                        </select>
                        {decision.action === "match" && (
                          <select
                            aria-label={`Existing group for ${group.sourceName || group.sourceNumber}`}
                            value={decision.existingGroupId ?? ""}
                            onChange={(event) => setDecision(group.key, { action: "match", existingGroupId: event.target.value ? Number(event.target.value) : null })}
                          >
                            <option value="">Select a group</option>
                            {groups.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}{option.groupNumber ? ` · ${option.groupNumber}` : ""}
                              </option>
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
            <button type="button" disabled={busy} onClick={confirmGroups}>
              {busy ? "Saving…" : "Confirm group decisions"}
            </button>
          </div>
        </div>
      )}
      {review && (
        <>
          {review.createdCount ? <p className="form-success">Created {review.createdCount} group{review.createdCount === 1 ? "" : "s"}. Assignment was not added and no compensation was created.</p> : null}
          {review.conflicts?.map((conflict) => <p key={conflict} className="form-error">{conflict}</p>)}
          {review.postedCount > 0 && <p className="form-success">Posted rows are now commission records. Reopening this statement will not post them twice.</p>}
          <p>
            {review.readyCount} ready · {review.blockedCount} blocked · {review.postedCount} already posted
          </p>
          <table>
            <thead>
              <tr>
                <th>Row</th>
                <th>Group</th>
                <th>Carrier</th>
                <th>Line</th>
                <th>Agent</th>
                <th>Gross</th>
                <th>Coverage month</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {review.rows.map((row) => (
                <tr key={row.sourceRowKey}>
                  <td>{row.rowNumber}</td>
                  <td>{row.groupLabel || "—"}</td>
                  <td>
                    {row.carrierLabel || "—"}
                    {row.carrierSource === "statement" ? <small> · statement carrier</small> : null}
                  </td>
                  <td>{row.lineOfBusinessLabel || "—"}</td>
                  <td>{row.agentLabel || "Unassigned"}</td>
                  <td>{row.grossCommissionCents == null ? "—" : formatCents(row.grossCommissionCents)}</td>
                  <td>{row.premiumMonth || "—"}</td>
                  <td>
                    <span className={`pill ${row.status === "ready" ? "ready_to_map" : row.status === "posted" ? "posted" : "review"}`}>
                      {row.status}
                    </span>
                    {row.exceptions.length > 0 && <small> {row.exceptions.join(" ")}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
