import { classifyStatementFile, type StatementFileKind } from "./statementFiles";

export const SPREADSHEET_READ_ERROR = "The statement could not be read. Confirm that it is a valid CSV or XLSX file.";
export const PDF_EXTRACTION_FAILED_ERROR = "PDF extraction failed — original retained.";
export const PDF_UNREADABLE_ERROR = "This PDF appears to be scanned or image-based. Automatic reading is not supported yet. The original file has been saved.";
export const PDF_NEEDS_LAYOUT_ERROR = "We found a table in this statement. Confirm the layout, then review the rows.";

export function inspectFailureMessage(kind: StatementFileKind | null) {
  if (kind === "pdf") return PDF_EXTRACTION_FAILED_ERROR;
  return SPREADSHEET_READ_ERROR;
}

export function fileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/(\.[a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function classifyInspectFile(fileName: string, mimeType: string, bytes?: ArrayBuffer | Uint8Array) {
  return classifyStatementFile(fileName, mimeType, bytes);
}

export function statementInspectLog(event: {
  outcome: string;
  classifiedAs: StatementFileKind | null;
  mimeType: string;
  extension: string;
  byteLength: number;
  persist: boolean;
  failureType?: string;
  errorName?: string;
}) {
  console.info("[statement-inspect]", JSON.stringify({
    outcome: event.outcome,
    classifiedAs: event.classifiedAs,
    mimeType: event.mimeType || "empty",
    extension: event.extension || "none",
    byteLength: event.byteLength,
    persist: event.persist,
    failureType: event.failureType ?? null,
    errorName: event.errorName ?? null,
  }));
}
