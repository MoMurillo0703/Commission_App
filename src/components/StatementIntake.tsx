"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";
import { currentPaidMonth, formatPaidMonthTitle, formatStatementMonth } from "@/domain/dates";
import type { ImportStatementView } from "@/data/statements";
import type { Carrier } from "@/db/schema";
import type { StatementPreview } from "@/domain/workbook";
import { acceptedStatementFiles, pdfNeedsLayoutConfirmation, STATEMENT_INTAKE_FORMATS, STATEMENT_INTAKE_LEAD, statementListActions } from "@/domain/statementActions";
import { pdfShouldUseExtractedConfirmation } from "@/domain/pdfIntakeSurface";
import { canReviewRows, isUnparsedStatement, statementCanBeDeleted, statementCanOpenReview, statementGuidance, statementHasExtractedText, statementStatusLabel } from "@/domain/statementWorkflow";
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
  const [manualReadHelp, setManualReadHelp] = useState(false);

  useEffect(() => {
    onPaidMonthChange?.(paidMonth);
  }, [paidMonth, onPaidMonthChange]);

  async function loadStatements(month: string) {
    const response = await fetchWithDeadline(`/api/imports/statements?paidMonth=${month}`);
    if (response.ok) setStatements(await readApiJson<ImportStatementView[]>(response));
  }

  async function refreshCarriers() {
    const response = await fetchWithDeadline("/api/carriers");
    if (response.ok) setCarriers(await readApiJson<Carrier[]>(response));
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
    setManualReadHelp(false);
    router.replace(`/statements?paidMonth=${value}`);
    await loadStatements(value);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedFiles.length === 0) {
      setResult({ status: "review", message: "Choose or drop at least one statement file." });
      return;
    }
    try {
      await runBusyAction(setBusy, async () => {
        const results: IntakeResult[] = [];
        let lastReviewable: IntakeResult | null = null;
        for (const file of selectedFiles) {
          const form = new FormData();
          form.set("statement", file);
          form.set("paidMonth", paidMonth);
          if (carrierId) form.set("carrierId", carrierId);
          if (carrierName.trim()) form.set("carrierName", carrierName.trim());
          const response = await fetchWithDeadline("/api/imports/inspect", { method: "POST", body: form });
          const body = await readApiJson<IntakeResult>(response);
          if (!response.ok && response.status !== 409) {
            results.push({
              fileName: file.name,
              status: "review",
              message: httpFailureMessage(response.status, body.message),
            });
            continue;
          }
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
        setManualReadHelp(false);
        await Promise.all([loadStatements(paidMonth), refreshCarriers()]);
        setCarrierName("");
        setSelectedFiles([]);
      });
    } catch (error) {
      setResult({
        status: "review",
        message: requestFailureMessage(error, "Unable to finish reading and saving that statement."),
      });
    }
  }

  async function inspectSaved(id: number) {
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${id}`);
        const body = await readApiJson<ImportStatementView & { message?: string }>(response);
        if (!response.ok) {
          setResult({ status: "review", message: httpFailureMessage(response.status, body.message) });
          return;
        }
        setPreview(body.preview ?? null);
        setActiveStatement(body);
        setManualReadHelp(false);
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
            hasExtractedText: statementHasExtractedText(body),
            pdfClassification: body.preview?.pdf?.classification,
          }).next,
        });
        await loadStatements(paidMonth);
      });
    } catch (error) {
      setResult({
        status: "review",
        message: requestFailureMessage(error, "Unable to open that statement."),
      });
    }
  }

  async function rename(id: number) {
    const response = await fetchWithDeadline(`/api/imports/statements/${id}`, {
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
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}`, { method: "DELETE" });
        const body = await readApiJson<{ message?: string; storageCleanupFailed?: boolean }>(response);
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
          setResult({ status: "review", message: httpFailureMessage(response.status, body.message) });
        }
      });
    } catch (error) {
      setResult({ status: "review", message: requestFailureMessage(error, "Unable to delete that statement.") });
    }
  }

  return (
    <section className="panel upload-panel">
      <div>
        <p className="eyebrow">Statement intake</p>
        <h2>{formatPaidMonthTitle(paidMonth)}</h2>
        <p>{STATEMENT_INTAKE_LEAD}</p>
        <p>{STATEMENT_INTAKE_FORMATS}</p>
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
            setSelectedFiles(acceptedStatementFiles(event.dataTransfer.files));
          }}
        >
          <strong>Drop statement files here</strong>
          <span>or click to choose Excel, CSV, or readable PDF files</span>
          <input
            id="statement"
            name="statement"
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            multiple
            onChange={(event) => setSelectedFiles(acceptedStatementFiles(event.target.files ?? []))}
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
          <strong>We found {preview.rowCount} commission record{preview.rowCount === 1 ? "" : "s"}</strong>
          <p>
            Confirm the extracted groups, coverage, premium, and commission below.
            {preview.newGroupCount ? ` ${preview.newGroupCount} unmatched group name${preview.newGroupCount === 1 ? "" : "s"} need review.` : ""}
          </p>
          {preview.unmatchedGroups.length > 0 && (
            <p>
              {preview.newGroupCount} Groups need review. Use Review {preview.newGroupCount} Group{preview.newGroupCount === 1 ? "" : "s"} below. They are not created at upload.
            </p>
          )}
          {preview.pdf?.layoutName && <p>Recognized carrier layout: {preview.pdf.layoutName}</p>}
        </div>
      )}
      {activeStatement && pdfNeedsLayoutConfirmation(activeStatement, preview) && !manualReadHelp && (
        <div className="result">
          <strong>Automatic reading needs a little help</strong>
          <p>The app extracted the text but could not confidently identify the commission table. This is an advanced fallback, not the normal workflow.</p>
          <div className="form-actions" style={{ marginTop: 12 }}>
            <button type="button" onClick={() => setManualReadHelp(true)}>
              Help the app read this statement
            </button>
          </div>
        </div>
      )}
      {activeStatement && pdfNeedsLayoutConfirmation(activeStatement, preview) && manualReadHelp && (
        <PdfLayoutReview
          statement={activeStatement}
          onConfirmed={(next) => {
            setActiveStatement(next);
            setPreview(next.preview);
            setManualReadHelp(false);
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
            setManualReadHelp(false);
          }}
        />
      )}
      {activeStatement && preview && canReviewRows(preview) && statementCanOpenReview(activeStatement.status, true, activeStatement.sourceType) && (
        <StatementPosting
          statement={activeStatement}
          preview={preview}
          variant={pdfShouldUseExtractedConfirmation(activeStatement) ? "extracted-confirm" : "spreadsheet"}
        />
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
            {statements.map((statement) => {
              const actions = statementListActions(statement);
              return (
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
                  <span className={`pill ${statement.status}`}>{actions.statusLabel}</span>
                </td>
                <td>
                  <div className="form-actions statement-row-actions">
                    <button
                      type="button"
                      className={actions.canOpenReview ? "" : "secondary"}
                      onClick={() => inspectSaved(statement.id)}
                    >
                      {actions.reviewLabel}
                    </button>
                    {actions.showViewOriginal && (
                      <a className="secondary" href={`/api/imports/statements/${statement.id}/file`} style={{ display: "inline-block", textDecoration: "none" }}>
                        View original
                      </a>
                    )}
                    {actions.showDownload && (
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
                    {actions.showDelete ? (
                      <button type="button" className="secondary" disabled={busy} onClick={() => removeStatement(statement)}>
                        Delete
                      </button>
                    ) : (
                      <button type="button" className="secondary" disabled title={actions.deleteBlockedReason ?? ""}>
                        Posted — cannot delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
