"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { currentPaidMonth, formatPaidMonthTitle, formatStatementMonth } from "@/domain/dates";
import type { ImportStatementView } from "@/data/statements";
import type { Carrier } from "@/db/schema";
import type { StatementPreview } from "@/domain/workbook";
import { StatementPosting } from "./StatementPosting";

type IntakeResult = {
  fileName?: string;
  fileType?: string;
  status: string;
  sheets?: { name: string; rowCount: number; headers: string[] }[];
  preview?: StatementPreview | null;
  statement?: ImportStatementView | null;
  message: string;
  existing?: ImportStatementView | null;
  carrierCreated?: boolean;
};

export function StatementIntake({
  initialPaidMonth = currentPaidMonth(),
  initialStatements = [],
  carriers: initialCarriers = [],
  onPaidMonthChange,
}: {
  initialPaidMonth?: string;
  initialStatements?: ImportStatementView[];
  carriers?: Carrier[];
  onPaidMonthChange?: (paidMonth: string) => void;
}) {
  const [paidMonth, setPaidMonth] = useState(initialPaidMonth);
  const [statements, setStatements] = useState(initialStatements);
  const [carriers, setCarriers] = useState(initialCarriers);
  const [carrierId, setCarrierId] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [activeStatement, setActiveStatement] = useState<ImportStatementView | null>(null);
  const [busy, setBusy] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    onPaidMonthChange?.(paidMonth);
  }, [paidMonth, onPaidMonthChange]);

  async function loadStatements(month: string) {
    const response = await fetch(`/api/imports/statements?paidMonth=${month}`);
    if (response.ok) setStatements(await response.json());
  }

  async function refreshCarriers() {
    const response = await fetch("/api/carriers");
    if (response.ok) setCarriers(await response.json());
  }

  const carrierHint = useMemo(() => {
    const typed = carrierName.trim();
    if (!typed) {
      return carrierId ? null : "Select an existing carrier or enter a new carrier name.";
    }
    const match = carriers.find((carrier) => carrier.name.trim().toLowerCase() === typed.toLowerCase());
    if (match) return `Will use existing carrier ${match.name}. A duplicate will not be created.`;
    return `A new carrier “${typed}” will be created.`;
  }, [carrierId, carrierName, carriers]);

  async function changeMonth(value: string) {
    setPaidMonth(value);
    setResult(null);
    setPreview(null);
    setActiveStatement(null);
    await loadStatements(value);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/imports/inspect", { method: "POST", body: new FormData(event.currentTarget) });
    const body = (await response.json()) as IntakeResult;
    setResult({ ...body, status: body.status ?? "review" });
    setPreview(body.preview ?? body.statement?.preview ?? null);
    setActiveStatement(body.statement ?? null);
    if (response.ok && body.statement) {
      await Promise.all([loadStatements(paidMonth), refreshCarriers()]);
      setCarrierName("");
      if (body.statement.carrierId) setCarrierId(String(body.statement.carrierId));
    }
    setBusy(false);
  }

  async function inspectSaved(id: number) {
    setBusy(true);
    const response = await fetch(`/api/imports/statements/${id}`);
    const body = await response.json();
    if (response.ok) {
      setPreview(body.preview ?? null);
      setActiveStatement(body);
      setResult({
        fileName: body.originalFilename,
        fileType: body.sourceType,
        status: body.status,
        preview: body.preview,
        statement: body,
        message: "Saved statement opened. Review unmatched groups before posting any rows.",
      });
    } else {
      setResult({ status: "review", message: body.message ?? "Unable to open that statement." });
    }
    setBusy(false);
  }

  async function rename(id: number) {
    const response = await fetch(`/api/imports/statements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: renameValue }),
    });
    if (response.ok) {
      setRenamingId(null);
      await loadStatements(paidMonth);
    }
  }

  return (
    <section className="panel upload-panel">
      <div>
        <p className="eyebrow">Statement intake</p>
        <h2>{formatPaidMonthTitle(paidMonth)}</h2>
        <p>Upload an Excel statement into the month the agency received the payment. Choose the carrier here so you do not have to leave this screen.</p>
      </div>
      <form onSubmit={upload}>
        <label>
          Paid month
          <input
            type="month"
            name="paidMonth"
            value={paidMonth}
            onChange={(event) => changeMonth(event.target.value)}
            required
          />
        </label>
        <label>
          Carrier
          <select name="carrierId" value={carrierId} onChange={(event) => setCarrierId(event.target.value)}>
            <option value="">Select an existing carrier</option>
            {carriers.map((carrier) => (
              <option key={carrier.id} value={carrier.id}>
                {carrier.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Or add a new carrier
          <input
            name="carrierName"
            value={carrierName}
            onChange={(event) => setCarrierName(event.target.value)}
            placeholder="Principal"
          />
        </label>
        {carrierHint && <p>{carrierHint}</p>}
        <input id="statement" name="statement" type="file" accept=".xlsx,.xls,.pdf" required />
        <button disabled={busy}>{busy ? "Saving…" : "Save statement"}</button>
      </form>
      {result && (
        <div className="result">
          <strong>{result.fileName ?? result.statement?.displayName}</strong>
          <span className={`pill ${result.status}`}>{result.status.replaceAll("_", " ")}</span>
          {result.statement?.carrierName && <p>Carrier: {result.statement.carrierName}{result.carrierCreated ? " (created with this upload)" : ""}</p>}
          <p>{result.message}</p>
          {result.existing && (
            <p>
              Already on file as {result.existing.displayName} ({formatStatementMonth(result.existing.paidMonth)}). Original file: {result.existing.originalFilename}.
            </p>
          )}
          {result.sheets?.map((sheet) => (
            <p key={sheet.name}>
              {sheet.name}: {sheet.rowCount} rows · {sheet.headers.join(", ") || "No headers found"}
            </p>
          ))}
        </div>
      )}
      {preview && (
        <div className="result">
          <strong>Import preview</strong>
          <p>
            {preview.rowCount} rows ready to map
            {preview.newGroupCount ? ` · ${preview.newGroupCount} unmatched group${preview.newGroupCount === 1 ? "" : "s"}` : ""}
          </p>
          {preview.unmatchedGroups.length > 0 && (
            <p>
              New groups pending review:{" "}
              {preview.unmatchedGroups
                .map((group) => group.sourceName || group.sourceNumber || "Unnamed group")
                .join(", ")}
              . They will not be created until reviewed.
            </p>
          )}
        </div>
      )}
      {activeStatement && preview && <StatementPosting statement={activeStatement} preview={preview} />}
      {statements.length === 0 ? (
        <p className="empty">No statements uploaded for this paid month.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Statement</th>
              <th>Carrier</th>
              <th>Original file</th>
              <th>Uploaded</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {statements.map((statement) => (
              <tr key={statement.id}>
                <td>
                  {renamingId === statement.id ? (
                    <span className="form-actions">
                      <input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                      <button type="button" onClick={() => rename(statement.id)}>
                        Save
                      </button>
                      <button type="button" className="secondary" onClick={() => setRenamingId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <strong>{statement.displayName}</strong>
                  )}
                </td>
                <td>{statement.carrierName || "—"}</td>
                <td>{statement.originalFilename}</td>
                <td>{new Date(statement.uploadedAt).toLocaleString()}</td>
                <td>{statement.sourceType}</td>
                <td>
                  <span className={`pill ${statement.status}`}>{statement.status.replaceAll("_", " ")}</span>
                </td>
                <td>
                  <div className="form-actions">
                    <button type="button" className="secondary" onClick={() => inspectSaved(statement.id)}>
                      Inspect
                    </button>
                    {statement.storedPath && (
                      <a className="secondary" href={`/api/imports/statements/${statement.id}/file`} style={{ display: "inline-block", textDecoration: "none" }}>
                        Download
                      </a>
                    )}
                    {renamingId !== statement.id && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setRenamingId(statement.id);
                          setRenameValue(statement.displayName);
                        }}
                      >
                        Rename
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
