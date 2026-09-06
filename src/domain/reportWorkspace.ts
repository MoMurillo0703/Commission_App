import type { IndividualReportRow, ReportKind } from "./reports";

export function individualRecipientTypeLabel(row: {
  personKind?: "agent" | "account_manager" | null;
  teamName?: string | null;
}) {
  const role = row.personKind === "account_manager"
    ? "Account manager"
    : row.personKind === "agent"
      ? "Agent"
      : "Person";
  if (row.teamName) return `Team member · ${role}`;
  return role;
}

export function isIndividualReportKind(kind: ReportKind | null | undefined) {
  return kind === "individual" || kind === "recipient";
}

export function individualReportNeedsRecipientAndMonth(kind: ReportKind) {
  return isIndividualReportKind(kind);
}

export function individualReportPrompt() {
  return "Choose a recipient and a paid month, then run the Individual Commission Report. The report uses posted payout snapshots and does not mark anyone paid.";
}

export function renderedReportKind(report: { filters?: { kind?: ReportKind } } | null) {
  return report?.filters?.kind ?? null;
}

export function canRenderIndividualRows(
  report: { filters?: { kind?: ReportKind }; rows?: unknown[] } | null,
) {
  return isIndividualReportKind(renderedReportKind(report)) && Array.isArray(report?.rows);
}

export function withRecipientType(rows: IndividualReportRow[]): IndividualReportRow[] {
  return rows.map((row) => ({
    ...row,
    recipientType: row.recipientType || individualRecipientTypeLabel(row),
  }));
}
