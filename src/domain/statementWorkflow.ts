export type StatementWorkflowStatus =
  | "ready_to_map"
  | "mapped"
  | "posted"
  | "partially_posted"
  | "needs_profile"
  | "needs_conversion"
  | "review";

export function statementStatusLabel(status: string, sourceType?: string | null) {
  if (status === "needs_profile" || sourceType === "pdf") return "PDF reading not supported yet";
  if (status === "needs_conversion" || sourceType === "xls") return "XLS reading not supported yet";
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

export function statementNextAction(status: string, hasReadableRows: boolean, sourceType?: string | null) {
  if (isUnparsedStatement({ status, sourceType })) return "View original";
  if (hasReadableRows && (status === "mapped" || status === "partially_posted")) return "Continue Import";
  if (hasReadableRows) return "Review Statement";
  if (status === "posted") return "View statement";
  return "Open statement";
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
}) {
  if (input.status === "needs_profile" || input.sourceType === "pdf") {
    return {
      title: "The app saved this PDF, but could not read its rows",
      why: "PDF commission statements are not extracted yet. The original file is kept so you can download it and continue later.",
      next: "Convert the statement to CSV or XLSX, or keep it on file and resume when extraction is available.",
    };
  }
  if (input.status === "needs_conversion" || input.sourceType === "xls") {
    return {
      title: "The app saved this older Excel file, but could not read its rows",
      why: "Legacy .xls files are not mapped by the current reader. The original file is kept.",
      next: "Save the file as .xlsx or .csv, then upload that version into the same paid month.",
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
      ? "The app read this statement and reused the last column layout for this carrier"
      : "The app read this statement and needs you to confirm it",
    why: unmatched
      ? `${unmatched} group name${unmatched === 1 ? "" : "s"} did not match a group already on file. Review them as new groups or match them to existing groups before posting.`
      : "Confirm the columns and any unmatched values before posting.",
    next: input.hasReadableRows ? "Review the statement, then continue the import when the rows look correct." : "Open the statement to see what still needs attention.",
  };
}

export function isUnparsedStatement(statement: { status?: string | null; sourceType?: string | null }) {
  return statement.sourceType === "pdf" || statement.sourceType === "xls" || statement.status === "needs_profile" || statement.status === "needs_conversion";
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
  return (statement.rowCount ?? 0) > 0 && (statement.sourceType === "csv" || statement.sourceType === "excel");
}
