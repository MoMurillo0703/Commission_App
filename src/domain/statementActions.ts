import {
  canReviewRows,
  isUnparsedStatement,
  statementCanBeDeleted,
  statementCanOpenReview,
  statementDeleteBlockedReason,
  statementHasExtractedText,
  statementHasReadableRows,
  statementKeepViewOriginal,
  statementNextAction,
  statementStatusLabel,
} from "./statementWorkflow";

export const STATEMENT_INTAKE_LEAD =
  "Upload a commission statement for the month the agency received payment. The app reads supported files automatically and shows the extracted commission data for confirmation.";

export const STATEMENT_INTAKE_FORMATS =
  "Supported formats: Excel, CSV, and readable PDF. Scanned or image-only PDFs cannot be read automatically.";

const supportedStatementName = /\.(csv|xlsx|xls|pdf)$/i;

export type StatementActionSource = {
  status?: string | null;
  sourceType?: string | null;
  extractionPath?: string | null;
  storedPath?: string | null;
  postedRowCount?: number | null;
  rowCount?: number | null;
  preview?: {
    sheets?: Array<{ rows?: unknown[] }>;
    pdf?: { classification?: string | null } | null;
  } | null;
};

export function acceptedStatementFiles(files: Iterable<File>) {
  return [...files].filter((file) => supportedStatementName.test(file.name));
}

export function statementHasExtractedPdfText(statement: StatementActionSource) {
  return statementHasExtractedText(statement);
}

export function pdfNeedsLayoutConfirmation(statement: StatementActionSource, preview?: StatementActionSource["preview"]) {
  const current = { ...statement, preview: preview ?? statement.preview };
  if (current.sourceType !== "pdf") return false;
  if (canReviewRows(current.preview)) return false;
  if (current.status === "unreadable" || current.status === "extraction_failed") return false;
  if (current.status === "needs_layout") return true;
  return current.status === "needs_profile" && statementHasExtractedPdfText(current);
}

export function statementListActions(statement: StatementActionSource) {
  const hasRows = statementHasReadableRows(statement);
  const extracted = statementHasExtractedPdfText(statement);
  const reviewable = hasRows || extracted || statement.status === "needs_layout";
  return {
    statusLabel: statementStatusLabel(statement.status ?? "", statement.sourceType, hasRows || extracted),
    reviewLabel: statementNextAction(statement.status ?? "", hasRows, statement.sourceType, statement),
    canOpenReview: statementCanOpenReview(statement.status ?? "", reviewable, statement.sourceType, statement),
    showViewOriginal: statementKeepViewOriginal(statement.status ?? "", hasRows, statement.sourceType, statement) && Boolean(statement.storedPath),
    showDownload: Boolean(statement.storedPath),
    showDelete: statementCanBeDeleted(statement),
    deleteBlockedReason: statementCanBeDeleted(statement) ? null : statementDeleteBlockedReason(),
    isUnparsed: isUnparsedStatement(statement, hasRows),
  };
}
