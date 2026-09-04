export type StatementWorkflowStatus =
  | "ready_to_map"
  | "mapped"
  | "posted"
  | "partially_posted"
  | "needs_profile"
  | "needs_layout"
  | "needs_conversion"
  | "unreadable"
  | "extraction_failed"
  | "review";

export type StatementExtractionContext = {
  status?: string | null;
  sourceType?: string | null;
  extractionPath?: string | null;
  preview?: { pdf?: { classification?: string | null } | null; sheets?: Array<{ rows?: unknown[] }> } | null;
};

export function statementHasExtractedText(statement: StatementExtractionContext | null | undefined) {
  if (!statement || statement.sourceType !== "pdf") return false;
  const classification = statement.preview?.pdf?.classification;
  if (classification === "readable" || classification === "needs_layout") return true;
  if (canReviewRows(statement.preview)) return true;
  return Boolean(statement.extractionPath);
}

export function statementStatusLabel(status: string, sourceType?: string | null, hasReadableRows = false) {
  if (status === "unreadable") return "Scanned/image PDF cannot yet be read";
  if (status === "extraction_failed") return "PDF extraction failed — original retained";
  if (status === "needs_layout") return "Needs help reading";
  if (status === "needs_conversion" || sourceType === "xls") return "XLS reading not supported yet";
  if (status === "needs_profile" && sourceType === "pdf" && !hasReadableRows) {
    return "Scanned/image PDF cannot yet be read";
  }
  if (sourceType === "pdf" && hasReadableRows) return "Text-based PDF successfully read";
  if (status === "needs_profile") return "Needs help reading";
  switch (status) {
    case "ready_to_map":
      return "Needs review";
    case "mapped":
      return "Ready to continue";
    case "posted":
      return "Posted";
    case "partially_posted":
      return "Partially posted";
    case "review":
      return "Needs attention";
    default:
      return status.replaceAll("_", " ");
  }
}

export function statementCanOpenReview(
  status: string,
  hasReadableRows: boolean,
  sourceType?: string | null,
  context?: StatementExtractionContext,
) {
  const statement = { status, sourceType, ...context };
  if (isUnparsedStatement(statement, hasReadableRows)) return false;
  return hasReadableRows
    || status === "needs_layout"
    || (sourceType === "pdf" && statementHasExtractedText(statement));
}

export function statementNextAction(
  status: string,
  hasReadableRows: boolean,
  sourceType?: string | null,
  context?: StatementExtractionContext,
) {
  const statement = { status, sourceType, ...context };
  if (isUnparsedStatement(statement, hasReadableRows)) return "View original";
  if (hasReadableRows && (status === "mapped" || status === "partially_posted")) return "Continue Import";
  if (hasReadableRows) return "Confirm extracted data";
  if (status === "needs_layout" || (sourceType === "pdf" && statementHasExtractedText(statement))) {
    return "Help the app read this statement";
  }
  if (status === "posted") return "View statement";
  return "Open statement";
}

export function statementKeepViewOriginal(
  status: string,
  hasReadableRows: boolean,
  sourceType?: string | null,
  context?: StatementExtractionContext,
) {
  const action = statementNextAction(status, hasReadableRows, sourceType, context);
  return action === "Confirm extracted data"
    || action === "Help the app read this statement"
    || action === "Continue Import";
}

export function statementNeedsUserInput(status: string) {
  return status !== "posted";
}

export function statementGuidance(input: {
  status: string;
  sourceType?: string | null;
  unmatchedGroupCount?: number;
  hasReadableRows?: boolean;
  hasExtractedText?: boolean;
  reusedMapping?: boolean;
  pdfClassification?: string | null;
}) {
  if (input.status === "unreadable" || input.pdfClassification === "unreadable") {
    return {
      title: "This PDF appears to be scanned or image-based",
      why: "Automatic reading is not supported yet. The original file has been saved.",
      next: "Download the original if you need it. A CSV or XLSX version can be uploaded for this paid month.",
    };
  }
  if (input.status === "extraction_failed" || input.pdfClassification === "failed") {
    return {
      title: "PDF extraction failed — original retained",
      why: "The app could not read commission rows from this file. The original PDF was saved.",
      next: "Download the original, or upload a CSV or XLSX version into the same paid month.",
    };
  }
  if (input.status === "needs_conversion" || input.sourceType === "xls") {
    return {
      title: "The app saved this older Excel file, but could not read its rows",
      why: "Legacy .xls files are not mapped by the current reader. The original file is kept.",
      next: "Save the file as .xlsx or .csv, then upload that version into the same paid month.",
    };
  }
  if ((input.status === "needs_layout" || input.pdfClassification === "needs_layout") && input.hasReadableRows) {
    return {
      title: "We extracted commission data from this statement",
      why: "Confirm or correct the extracted values below, then post. Mapping is only needed if the columns look wrong.",
      next: "Confirm the extracted commission data. Use Help the app read this statement only if the automatic reading looks wrong.",
    };
  }
  if (input.status === "needs_layout" || input.pdfClassification === "needs_layout") {
    return {
      title: "The app could not automatically find the commission table",
      why: "The words on the page were read, but the table could not be identified with enough confidence.",
      next: "Use Help the app read this statement if you want to mark the table, or upload a CSV or XLSX for this paid month.",
    };
  }
  if (input.status === "needs_profile" && input.sourceType === "pdf" && !input.hasReadableRows && !input.hasExtractedText) {
    return {
      title: "This PDF appears to be scanned or image-based",
      why: "Automatic reading is not supported yet. The original file has been saved.",
      next: "Download the original if you need it. A CSV or XLSX version can be uploaded for this paid month.",
    };
  }
  if (input.status === "needs_profile" && input.sourceType === "pdf") {
    return {
      title: "The app could not automatically find the commission table",
      why: "The words on the page were read, but the table could not be identified with enough confidence.",
      next: "Use Help the app read this statement if you want to mark the table, or upload a CSV or XLSX for this paid month.",
    };
  }
  if (input.status === "posted") {
    return {
      title: "This statement has been posted",
      why: "Posted rows are stored commission records and will not be posted twice.",
      next: "Download the original file or review the posted rows if needed.",
    };
  }
  const unmatched = input.unmatchedGroupCount ?? 0;
  return {
    title: input.reusedMapping
      ? input.sourceType === "pdf"
        ? "The app recognized this carrier layout and extracted candidate rows"
        : "The app read this statement and reused the last column layout for this carrier"
      : input.sourceType === "pdf"
        ? "The app automatically read this statement and needs you to confirm the extracted data"
      : "The app automatically read this statement and needs you to confirm the extracted data",
    why: unmatched
      ? `${unmatched} group name${unmatched === 1 ? "" : "s"} did not match a group already on file. Review them as new groups or match them to existing groups before posting.`
      : "Confirm or correct the extracted commission data, then post.",
    next: input.hasReadableRows
      ? "Confirm the extracted rows, resolve any unmatched values, then post."
      : input.status === "needs_layout"
        ? "Use Help the app read this statement if you want to mark the table."
        : "Open the statement to confirm the extracted commission data.",
  };
}

export function isUnparsedStatement(
  statement: StatementExtractionContext,
  hasReadableRows = false,
) {
  if (statement.sourceType === "xls" || statement.status === "needs_conversion") return true;
  if (statement.status === "unreadable" || statement.status === "extraction_failed") return true;
  if (hasReadableRows) return false;
  if (statement.status === "needs_layout") return false;
  if (statement.status === "needs_profile") return !statementHasExtractedText(statement);
  return false;
}

export function canReviewRows(preview: { sheets?: Array<{ rows?: unknown[] }> } | null | undefined) {
  return Boolean(preview?.sheets?.some((sheet) => (sheet.rows?.length ?? 0) > 0));
}

export function statementHasReadableRows(statement: {
  preview?: { sheets?: Array<{ rows?: unknown[] }> } | null;
  rowCount?: number | null;
  sourceType?: string | null;
}) {
  if (canReviewRows(statement.preview)) return true;
  return (statement.rowCount ?? 0) > 0 && (statement.sourceType === "csv" || statement.sourceType === "excel" || statement.sourceType === "pdf");
}

export function statementCanBeDeleted(statement: { status?: string | null; postedRowCount?: number | null }) {
  if ((statement.postedRowCount ?? 0) > 0) return false;
  return statement.status !== "posted" && statement.status !== "partially_posted";
}

export function statementDeleteBlockedReason() {
  return "This statement has posted commissions and cannot be deleted. Posted rows are part of the audit trail.";
}
