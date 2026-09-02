"use client";

import { useMemo, useState } from "react";
import type { ImportStatementView } from "@/data/statements";
import { collectPreviewHeaders, mappingFieldLabels, mappingFields, suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import type { ValidatedImportRow } from "@/domain/importRows";
import { formatCents } from "@/domain/money";
import type { StatementPreview } from "@/domain/workbook";

type PreviewResponse = {
  paidMonth: string;
  rows: ValidatedImportRow[];
  readyCount: number;
  blockedCount: number;
  postedCount: number;
  message?: string;
};

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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setField(field: keyof ColumnMapping, value: string) {
    setMapping((current) => ({ ...current, [field]: value || null }));
    setReview(null);
  }

  async function runPreview() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/statements/${statement.id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnMapping: mapping }),
    });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to preview rows.");
      return;
    }
    setReview(body);
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

  return (
    <div className="result">
      <strong>Map and review before posting</strong>
      <p>
        Paid month is {statement.paidMonth}
        {statement.carrierName ? ` · statement carrier is ${statement.carrierName}` : ""}.
        Premium / coverage month stays on the row when mapped.
        {statement.carrierName
          ? " Map a Carrier column only if this file contains more than one carrier."
          : " Map a Carrier column for each row."}
      </p>
      <div className="form-grid form-grid-wide">
        {mappingFields.map((field) => (
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
          {busy ? "Working…" : "Preview rows"}
        </button>
        <button type="button" disabled={busy || !review || review.readyCount === 0} onClick={postReady}>
          {review ? `Post ${review.readyCount} ready row${review.readyCount === 1 ? "" : "s"}` : "Post ready rows"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {review && (
        <>
          <p>
            {review.readyCount} ready · {review.blockedCount} blocked · {review.postedCount} already posted
          </p>
          {review.rows.some((row) => row.exceptions.some((item) => item.includes("Unmatched group"))) && (
            <p>Unmatched groups will not be created. Add the group first, then preview again.</p>
          )}
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
                  <td>{row.carrierLabel || "—"}</td>
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
