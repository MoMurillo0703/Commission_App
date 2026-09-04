"use client";

import { useEffect, useMemo, useState } from "react";
import type { ImportStatementView } from "@/data/statements";
import { fetchWithDeadline, httpFailureMessage, readApiJson, requestFailureMessage, runBusyAction } from "@/lib/apiClient";
import {
  previewFromConfirmedPdfLayout,
  type PdfLayoutLine,
  type PdfLayoutSelection,
} from "@/domain/pdfLayoutConfirm";
import type { ExtractedPdfPage } from "@/domain/pdfExtraction";
import type { StatementPreview } from "@/domain/workbook";

type ExtractionResponse = {
  statementId: number;
  classification: "readable" | "unreadable" | "failed" | "needs_layout";
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    lines: PdfLayoutLine[];
  }>;
  message: string;
};

type MarkKind = "header" | "start" | "end";

function lineKey(line: Pick<PdfLayoutLine, "pageNumber" | "lineNumber">) {
  return `${line.pageNumber}:${line.lineNumber}`;
}

export function PdfLayoutReview({
  statement,
  onConfirmed,
  onCancel,
}: {
  statement: ImportStatementView;
  onConfirmed: (next: ImportStatementView) => void;
  onCancel: () => void;
}) {
  const [extraction, setExtraction] = useState<ExtractionResponse | null>(null);
  const [mark, setMark] = useState<MarkKind>("header");
  const [header, setHeader] = useState<PdfLayoutLine | null>(null);
  const [start, setStart] = useState<PdfLayoutLine | null>(null);
  const [end, setEnd] = useState<PdfLayoutLine | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchWithDeadline(`/api/imports/statements/${statement.id}/extraction`)
      .then(async (response) => {
        const body = await readApiJson<ExtractionResponse & { message?: string }>(response);
        if (!response.ok) throw new Error(httpFailureMessage(response.status, body.message));
        if (cancelled) return;
        setExtraction(body);
        setEnd(body.pages.at(-1)?.lines.at(-1) ?? null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(requestFailureMessage(loadError, "Unable to load the extracted PDF text."));
      });
    return () => {
      cancelled = true;
    };
  }, [statement.id]);

  const pages: ExtractedPdfPage[] = useMemo(() => (
    (extraction?.pages ?? []).map((page) => ({
      pageNumber: page.pageNumber,
      text: page.lines.map((line) => line.text).join("\n"),
      lines: page.lines.map((line) => line.text),
    }))
  ), [extraction]);

  const selection = useMemo<PdfLayoutSelection | null>(() => {
    if (!header || !start || !end) return null;
    return {
      headerPageNumber: header.pageNumber,
      headerLineNumber: header.lineNumber,
      dataStartPageNumber: start.pageNumber,
      dataStartLineNumber: start.lineNumber,
      dataEndPageNumber: end.pageNumber,
      dataEndLineNumber: end.lineNumber,
    };
  }, [header, start, end]);

  const preview: StatementPreview | null = useMemo(() => {
    if (!selection) return null;
    return previewFromConfirmedPdfLayout(pages, selection).preview;
  }, [pages, selection]);

  function chooseLine(line: PdfLayoutLine) {
    if (mark === "header") {
      setHeader(line);
      setMark("start");
      return;
    }
    if (mark === "start") {
      setStart(line);
      setMark("end");
      return;
    }
    setEnd(line);
  }

  async function confirm() {
    if (!selection) {
      setError("Mark the header row and where the commission rows begin and end.");
      return;
    }
    setError("");
    try {
      await runBusyAction(setBusy, async () => {
        const response = await fetchWithDeadline(`/api/imports/statements/${statement.id}/pdf-layout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(selection),
        });
        const body = await readApiJson<ImportStatementView & { message?: string }>(response);
        if (!response.ok) {
          setError(httpFailureMessage(response.status, body.message));
          return;
        }
        onConfirmed(body);
      });
    } catch (error) {
      setError(requestFailureMessage(error, "Unable to confirm this layout."));
    }
  }

  const scanned = extraction?.classification === "unreadable";
  const failed = extraction?.classification === "failed";

  return (
    <div className="result pdf-layout-review">
      <p className="eyebrow">Advanced reading help</p>
      <strong>Help the app read this statement</strong>
      <p>This is a fallback when automatic reading cannot find the commission table. Mark the header row, the first commission row, and the last commission row. Confirming the layout does not post commissions.</p>
      <div className="form-actions" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className={mark === "header" ? "" : "secondary"} onClick={() => setMark("header")}>
          Header row
        </button>
        <button type="button" className={mark === "start" ? "" : "secondary"} onClick={() => setMark("start")}>
          Data begins
        </button>
        <button type="button" className={mark === "end" ? "" : "secondary"} onClick={() => setMark("end")}>
          Data ends
        </button>
      </div>
      <p>
        Header: {header ? `Page ${header.pageNumber}, line ${header.lineNumber}` : "not marked"}
        {" · "}
        Begins: {start ? `Page ${start.pageNumber}, line ${start.lineNumber}` : "not marked"}
        {" · "}
        Ends: {end ? `Page ${end.pageNumber}, line ${end.lineNumber}` : "not marked"}
      </p>
      {scanned && <p>{extraction?.message}</p>}
      {failed && <p>{extraction?.message}</p>}
      {error && <p className="form-error">{error}</p>}
      {extraction && !scanned && !failed && (
        <div className="pdf-extracted-pages">
          {extraction.pages.map((page) => (
            <div key={page.pageNumber} className="pdf-extracted-page">
              <strong>Page {page.pageNumber}</strong>
              <ol className="pdf-extracted-lines">
                {page.lines.map((line) => {
                  const role = lineKey(line) === (header ? lineKey(header) : "")
                    ? "header"
                    : lineKey(line) === (start ? lineKey(start) : "")
                      ? "start"
                      : lineKey(line) === (end ? lineKey(end) : "")
                        ? "end"
                        : "";
                  return (
                    <li key={lineKey(line)}>
                      <button
                        type="button"
                        className={`linkish pdf-extracted-line ${role}`}
                        onClick={() => chooseLine(line)}
                      >
                        <span className="pdf-line-number">{line.lineNumber}</span>
                        <span>{line.text}</span>
                        {role === "header" && <em>Header</em>}
                        {role === "start" && <em>Begins</em>}
                        {role === "end" && <em>Ends</em>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="pdf-layout-preview">
          <strong>Preview of resulting rows</strong>
          <p>
            {preview.rowCount === 0
              ? "No commission rows yet. Repeated headers, totals, and page labels are left out."
              : `${preview.rowCount} row${preview.rowCount === 1 ? "" : "s"} will continue into confirmation.`}
          </p>
          {preview.sheets[0] && preview.rowCount > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  {preview.sheets[0].headers.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.sheets.flatMap((sheet) => sheet.rows.slice(0, 8).map((row) => (
                  <tr key={row.sourceIdentity ?? `${sheet.name}-${row.rowNumber}`}>
                    <td>{row.pageNumber ?? sheet.name}</td>
                    {sheet.headers.map((column) => (
                      <td key={column}>{row.values[column] || "—"}</td>
                    ))}
                  </tr>
                )))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="form-actions" style={{ marginTop: 14 }}>
        <button type="button" disabled={busy || !selection || scanned || failed} onClick={() => void confirm()}>
          {busy ? "Confirming…" : "Confirm Layout"}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel / Back
        </button>
      </div>
    </div>
  );
}
