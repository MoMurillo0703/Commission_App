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

export function statementStatusLabel(status: string, sourceType?: string | null, hasReadableRows = false) {
  if (status === "unreadable") return "Scanned/image PDF cannot yet be read";
  if (status === "extraction_failed") return "PDF extraction failed — original retained";
  if (status === "needs_layout") return "PDF needs layout confirmation";
  if (status === "needs_conversion" || sourceType === "xls") return "XLS reading not supported yet";
  if (status === "needs_profile" && sourceType === "pdf" && !hasReadableRows) {
    return "Scanned/image PDF cannot yet be read";
  }
  if (sourceType === "pdf" && hasReadableRows) return "Text-based PDF successfully read";
  if (status === "needs_profile") return "PDF needs layout confirmation";
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

export function statementCanOpenReview(status: string, hasReadableRows: boolean, sourceType?: string | null) {
  if (isUnparsedStatement({ status, sourceType }, hasReadableRows)) return false;
  return hasReadableRows || status === "needs_layout" || (sourceType === "pdf" && status === "needs_profile" && hasReadableRows);
}

export function statementNextAction(status: string, hasReadableRows: boolean, sourceType?: string | null) {
  if (isUnparsedStatement({ status, sourceType }, hasReadableRows)) return "View original";
  if (hasReadableRows && (status === "mapped" || status === "partially_posted")) return "Continue Import";
  if (status === "needs_layout" || (hasReadableRows && sourceType === "pdf")) return "Review Statement";
  if (hasReadableRows) return "Review Statement";
  if (status === "posted") return "View statement";
  return "Open statement";
}

export function statementKeepViewOriginal(status: string, hasReadableRows: boolean, sourceType?: string | null) {
  const action = statementNextAction(status, hasReadableRows, sourceType);
  return action === "Review Statement" || action === "Continue Import";
}

export function statementNeedsUserInput(status: string) {
  return status !== "posted";
}

export function statementGuidance(input: {
  status: string;
  sourceType?: string | null;
  unmatchedGroupCount?: number;
  hasReadableRows?: boolean;
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
      title: "We found a table in this statement",
      why: "Confirm which columns contain Group, Group number, line of business, Agent, Premium, Gross commission, coverage month, and Notes.",
      next: "Use Review Statement to confirm the columns, then review unmatched Groups, lines of business, and Agents before posting.",
    };
  }
  if (input.status === "needs_layout" || input.pdfClassification === "needs_layout") {
    return {
      title: "We could read this PDF, but we need your help identifying the commission table.",
      why: "The words on the page were read, but the app could not find the commission table on its own.",
      next: "Use Review Statement to mark the header row and where the commission rows begin and end. If this file has no commission table, download the original and upload a CSV or XLSX for this paid month.",
    };
  }
  if (input.status === "needs_profile" && input.sourceType === "pdf" && !input.hasReadableRows) {
    return {
      title: "This PDF appears to be scanned or image-based",
      why: "Automatic reading is not supported yet. The original file has been saved.",
      next: "Download the original if you need it. A CSV or XLSX version can be uploaded for this paid month.",
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
        ? "The app read this text-based PDF and needs you to confirm it"
      : "The app read this statement and needs you to confirm it",
    why: unmatched
      ? `${unmatched} group name${unmatched === 1 ? "" : "s"} did not match a group already on file. Review them as new groups or match them to existing groups before posting.`
      : "Confirm the columns and any unmatched values before posting.",
    next: input.hasReadableRows
      ? "Resolve unmatched items, review the financial rows, then continue the import."
      : input.status === "needs_layout"
        ? "Use Review Statement to mark the header row and where the commission rows begin and end."
        : "Use Review Statement to continue the extracted statement review.",
  };
}

export function isUnparsedStatement(
  statement: { status?: string | null; sourceType?: string | null },
  hasReadableRows = false,
) {
  if (statement.sourceType === "xls" || statement.status === "needs_conversion") return true;
  if (statement.status === "unreadable" || statement.status === "extraction_failed") return true;
  if (hasReadableRows) return false;
  if (statement.status === "needs_layout") return false;
  return statement.status === "needs_profile";
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
