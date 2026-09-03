"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { currentPaidMonth, formatPaidMonthTitle, formatStatementMonth } from "@/domain/dates";
import type { ImportStatementView } from "@/data/statements";
import type { Carrier } from "@/db/schema";
import type { StatementPreview } from "@/domain/workbook";
import { canReviewRows, isUnparsedStatement, statementCanBeDeleted, statementCanOpenReview, statementDeleteBlockedReason, statementGuidance, statementHasReadableRows, statementKeepViewOriginal, statementNextAction, statementStatusLabel } from "@/domain/statementWorkflow";
import { PdfLayoutReview } from "./PdfLayoutReview";
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
  reusedMapping?: boolean;
};

export function StatementIntake({
  initialPaidMonth = currentPaidMonth(),
  initialStatements = [],
  availablePaidMonths = [],
  carriers: initialCarriers = [],
  onPaidMonthChange,
}: {
  initialPaidMonth?: string;
  initialStatements?: ImportStatementView[];
  availablePaidMonths?: string[];
  carriers?: Carrier[];
  onPaidMonthChange?: (paidMonth: string) => void;
}) {
  const router = useRouter();
  const [paidMonth, setPaidMonth] = useState(initialPaidMonth);
  const [statements, setStatements] = useState(initialStatements);
  const [carriers, setCarriers] = useState(initialCarriers);
  const [carrierId, setCarrierId] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [batchResults, setBatchResults] = useState<IntakeResult[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
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
    router.replace(`/statements?paidMonth=${value}`);
    await loadStatements(value);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setResult({ status: "review", message: "Choose or drop at least one statement file." });
      return;
    }
    setBusy(true);
    const results: IntakeResult[] = [];
    let lastReviewable: IntakeResult | null = null;
    for (const file of selectedFiles) {
      const form = new FormData();
      form.set("statement", file);
      form.set("paidMonth", paidMonth);
      if (carrierId) form.set("carrierId", carrierId);
      if (carrierName.trim()) form.set("carrierName", carrierName.trim());
      const response = await fetch("/api/imports/inspect", { method: "POST", body: form });
      const body = (await response.json()) as IntakeResult;
      const statement = body.statement ?? body.existing ?? null;
      const normalized = { ...body, fileName: body.fileName ?? file.name, status: body.status ?? statement?.status ?? "review", statement };
      results.push(normalized);
      if (statement && (canReviewRows(statement.preview ?? body.preview) || statement.status === "needs_layout")) {
        lastReviewable = normalized;
      }
    }
    setBatchResults(results);
    setResult(results.length === 1 ? results[0] : null);
    setPreview(lastReviewable?.preview ?? lastReviewable?.statement?.preview ?? null);
    setActiveStatement(lastReviewable?.statement ?? null);
    await Promise.all([loadStatements(paidMonth), refreshCarriers()]);
    setCarrierName("");
    setSelectedFiles([]);
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
        message: statementGuidance({
          status: body.status,
          sourceType: body.sourceType,
          unmatchedGroupCount: body.preview?.newGroupCount,
          hasReadableRows: canReviewRows(body.preview),
        }).next,
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

  async function removeStatement(statement: ImportStatementView) {
    if (!statementCanBeDeleted(statement)) return;
    if (!window.confirm(`Delete “${statement.displayName}” and its original file? Groups, carriers, people, and compensation already on file will be kept.`)) {
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/imports/statements/${statement.id}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { message?: string; storageCleanupFailed?: boolean };
    if (response.ok) {
      if (activeStatement?.id === statement.id) {
        setActiveStatement(null);
        setPreview(null);
        setResult(null);
      }
      await loadStatements(paidMonth);
      if (body.storageCleanupFailed) {
        setResult({ status: "review", message: body.message ?? "The statement was deleted, but its stored file still needs cleanup." });
      }
    } else {
      setResult({ status: "review", message: body.message ?? "Unable to delete that statement." });
    }
    setBusy(false);
  }

  return (
    <section className="panel upload-panel">
      <div>
        <p className="eyebrow">Statement intake</p>
        <h2>{formatPaidMonthTitle(paidMonth)}</h2>
        <p>Upload statements for the month the agency received payment. The app reads each file, then you review anything it could not determine and post the ready rows.</p>
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
        <p>The selected carrier applies to every file in this upload. Upload different carriers separately.</p>
        <label
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            setSelectedFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <strong>Drop statement files here</strong>
          <span>or choose CSV, XLSX, XLS, or PDF files</span>
          <input
            id="statement"
            name="statement"
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            multiple
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
          />
          {selectedFiles.length > 0 && <small>{selectedFiles.map((file) => file.name).join(" · ")}</small>}
        </label>
        <button disabled={busy}>{busy ? "Reading and saving…" : `Read ${selectedFiles.length || ""} statement${selectedFiles.length === 1 ? "" : "s"}`}</button>
      </form>
      {batchResults.length > 1 && (
        <div className="result">
          <strong>Upload results</strong>
          {batchResults.map((item, index) => (
            <p key={`${item.fileName}-${index}`}><span className={`pill ${item.status}`}>{statementStatusLabel(item.status, item.fileType)}</span> {item.fileName}: {item.message}</p>
          ))}
        </div>
      )}
      {result && (
        <div className="result">
          <strong>{result.fileName ?? result.statement?.displayName}</strong>
          <span className={`pill ${result.status}`}>{statementStatusLabel(result.status, result.fileType ?? result.statement?.sourceType, canReviewRows(result.preview ?? result.statement?.preview))}</span>
          {result.statement?.carrierName && <p>Carrier: {result.statement.carrierName}{result.carrierCreated ? " (created with this upload)" : ""}</p>}
          <p>{result.message}</p>
          {result.statement && (
            <p>
              {statementGuidance({
                status: result.status,
                sourceType: result.fileType,
                unmatchedGroupCount: result.preview?.newGroupCount ?? result.statement.preview?.newGroupCount,
                hasReadableRows: canReviewRows(result.preview ?? result.statement.preview),
                reusedMapping: result.reusedMapping,
              }).why}
            </p>
          )}
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
      {activeStatement && isUnparsedStatement(activeStatement, canReviewRows(preview ?? activeStatement.preview)) && (
        <div className="result">
          <strong>{statementStatusLabel(activeStatement.status, activeStatement.sourceType, false)}</strong>
          <p>{statementGuidance({ status: activeStatement.status, sourceType: activeStatement.sourceType, hasReadableRows: false, pdfClassification: activeStatement.preview?.pdf?.classification }).why}</p>
          <p>{statementGuidance({ status: activeStatement.status, sourceType: activeStatement.sourceType, hasReadableRows: false, pdfClassification: activeStatement.preview?.pdf?.classification }).next}</p>
          {activeStatement.storedPath && (
            <p>
              <a className="secondary" href={`/api/imports/statements/${activeStatement.id}/file`} style={{ display: "inline-block", textDecoration: "none" }}>
                Download original
              </a>
            </p>
          )}
        </div>
      )}
      {preview && !isUnparsedStatement(activeStatement ?? {}, canReviewRows(preview)) && canReviewRows(preview) && (
        <div className="result">
          <strong>Import preview</strong>
          <p>
            {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} read
            {preview.newGroupCount ? ` · ${preview.newGroupCount} unmatched group name${preview.newGroupCount === 1 ? "" : "s"} to review` : ""}
          </p>
          {preview.unmatchedGroups.length > 0 && (
            <p>
              {preview.newGroupCount} Groups need review. Use Review {preview.newGroupCount} Group{preview.newGroupCount === 1 ? "" : "s"} below. They are not created at upload.
            </p>
          )}
          {preview.pdf?.layoutName && <p>Recognized carrier layout: {preview.pdf.layoutName}</p>}
        </div>
      )}
      {activeStatement && preview && activeStatement.status === "needs_layout" && !canReviewRows(preview) && (
        <PdfLayoutReview
          statement={activeStatement}
          onConfirmed={(next) => {
            setActiveStatement(next);
            setPreview(next.preview);
            setResult({
              fileName: next.originalFilename,
              fileType: next.sourceType,
              status: next.status,
              preview: next.preview,
              statement: next,
              message: statementGuidance({
                status: next.status,
                sourceType: next.sourceType,
                unmatchedGroupCount: next.preview?.newGroupCount,
                hasReadableRows: canReviewRows(next.preview),
                pdfClassification: next.preview?.pdf?.classification,
              }).next,
            });
            void loadStatements(paidMonth);
          }}
          onCancel={() => {
            setActiveStatement(null);
            setPreview(null);
          }}
        />
      )}
      {activeStatement && preview && canReviewRows(preview) && statementCanOpenReview(activeStatement.status, true, activeStatement.sourceType) && (
        <StatementPosting statement={activeStatement} preview={preview} />
      )}
      {availablePaidMonths.length > 0 && (
        <div className="month-links" aria-label="Statement paid months">
          <strong>Open paid month:</strong>
          {availablePaidMonths.map((month) => (
            <button key={month} type="button" className={month === paidMonth ? "" : "secondary"} onClick={() => changeMonth(month)}>
              {formatStatementMonth(month)}
            </button>
          ))}
        </div>
      )}
      {statements.length === 0 ? (
        <p className="empty">No statements uploaded for this paid month.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Statement</th>
              <th>Paid month</th>
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
                <td>{formatStatementMonth(statement.paidMonth)}</td>
                <td>{statement.carrierName || "—"}</td>
                <td>{statement.originalFilename}</td>
                <td>{new Date(statement.uploadedAt).toLocaleString()}</td>
                <td>{statement.sourceType}</td>
                <td>
                  <span className={`pill ${statement.status}`}>{statementStatusLabel(statement.status, statement.sourceType, statementHasReadableRows(statement))}</span>
                </td>
                <td>
                  <div className="form-actions">
                    <button
                      type="button"
                      className={statementCanOpenReview(statement.status, statementHasReadableRows(statement), statement.sourceType) ? "" : "secondary"}
                      onClick={() => inspectSaved(statement.id)}
                    >
                      {statementNextAction(statement.status, statementHasReadableRows(statement), statement.sourceType)}
                    </button>
                    {statementKeepViewOriginal(statement.status, statementHasReadableRows(statement), statement.sourceType) && statement.storedPath && (
                      <a className="secondary" href={`/api/imports/statements/${statement.id}/file`} style={{ display: "inline-block", textDecoration: "none" }}>
                        View original
                      </a>
                    )}
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
                    {statementCanBeDeleted(statement) ? (
                      <button type="button" className="secondary" disabled={busy} onClick={() => removeStatement(statement)}>
                        Delete
                      </button>
                    ) : (
                      <button type="button" className="secondary" disabled title={statementDeleteBlockedReason()}>
                        Posted — cannot delete
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
