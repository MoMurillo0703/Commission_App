import { printableSuiteStyles } from "@/theme/tokens";
import { formatCents } from "./money";
import { formatStatementMonth } from "./dates";
import {
  reportPeriodLabel,
  type AgencyReportRow,
  type IndividualReportRow,
  type ReportFilters,
  type ReportKind,
  type ReportTotals,
  type TeamReportRow,
  toCsv,
} from "./reports";

export const AGENCY_NAME = "Murillo Insurance";

export type ReportDocument = {
  agencyName: string;
  title: string;
  period: string;
  filtersUsed: string[];
  generatedAt: string;
  totals: Array<{ label: string; value: string }>;
  headers: string[];
  rows: string[][];
};

function filterLines(filters: ReportFilters, names: {
  groupName?: string | null;
  carrierName?: string | null;
  lineName?: string | null;
  personName?: string | null;
  teamName?: string | null;
  accountManagerName?: string | null;
  primaryAgentName?: string | null;
}) {
  const lines = [`Period: ${reportPeriodLabel(filters)}`];
  lines.push(`Group: ${names.groupName || "All"}`);
  lines.push(`Carrier: ${names.carrierName || "All"}`);
  lines.push(`Line of business: ${names.lineName || "All"}`);
  if (filters.kind === "individual") lines.push(`Recipient: ${names.personName || "All people"}`);
  if (filters.kind === "team") lines.push(`Team: ${names.teamName || "All teams"}`);
  lines.push(`Account manager: ${names.accountManagerName || "All"}`);
  lines.push(`Primary agent: ${names.primaryAgentName || "All"}`);
  return lines;
}

function reportTitle(kind: ReportKind) {
  if (kind === "agency") return "Agency Commission Report";
  if (kind === "individual") return "Individual Compensation Report";
  return "Team Compensation Report";
}

export function agencyReportDocument(
  rows: AgencyReportRow[],
  totals: ReportTotals,
  filters: ReportFilters,
  names: Parameters<typeof filterLines>[1],
  generatedAt = new Date(),
): ReportDocument {
  return {
    agencyName: AGENCY_NAME,
    title: reportTitle("agency"),
    period: reportPeriodLabel(filters),
    filtersUsed: filterLines(filters, names),
    generatedAt: generatedAt.toISOString(),
    totals: [
      { label: "Total Premium", value: formatCents(totals.premiumCents) },
      { label: "Total Gross Commission", value: formatCents(totals.grossCommissionCents) },
      { label: "Total Compensation", value: formatCents(totals.compensationDistributedCents) },
      { label: "Total Agency Net", value: formatCents(totals.agencyNetCents) },
    ],
    headers: ["Paid Month", "Group", "Carrier", "LOB", "Premium", "Gross Commission", "Compensation Distributed", "Agency Net"],
    rows: rows.map((row) => [
      formatStatementMonth(row.paidMonth),
      row.groupName,
      row.carrierName,
      row.lineOfBusinessName,
      row.premiumCents == null ? "—" : formatCents(row.premiumCents),
      formatCents(row.grossCommissionCents),
      formatCents(row.compensationDistributedCents),
      formatCents(row.agencyNetCents),
    ]),
  };
}

export function individualReportDocument(
  rows: IndividualReportRow[],
  totals: { compensationCents: number },
  filters: ReportFilters,
  names: Parameters<typeof filterLines>[1],
  recipientName: string,
  generatedAt = new Date(),
): ReportDocument {
  return {
    agencyName: AGENCY_NAME,
    title: reportTitle("individual"),
    period: reportPeriodLabel(filters),
    filtersUsed: filterLines({ ...filters, kind: "individual" }, { ...names, personName: recipientName }),
    generatedAt: generatedAt.toISOString(),
    totals: [
      { label: `Total ${recipientName} Compensation`, value: formatCents(totals.compensationCents) },
    ],
    headers: ["Paid Month", "Group", "Carrier", "LOB", "Gross Commission", "Applicable %", "Compensation Earned"],
    rows: rows.map((row) => [
      formatStatementMonth(row.paidMonth),
      row.groupName,
      row.carrierName,
      row.lineOfBusinessName,
      formatCents(row.grossCommissionCents),
      `${(row.allocationBps / 100).toFixed(row.allocationBps % 100 === 0 ? 0 : 2)}%`,
      formatCents(row.compensationCents),
    ]),
  };
}

export function teamReportDocument(
  rows: TeamReportRow[],
  totals: { teamCompensationCents: number; memberCompensationCents: number },
  filters: ReportFilters,
  names: Parameters<typeof filterLines>[1],
  generatedAt = new Date(),
): ReportDocument {
  return {
    agencyName: AGENCY_NAME,
    title: reportTitle("team"),
    period: reportPeriodLabel(filters),
    filtersUsed: filterLines({ ...filters, kind: "team" }, names),
    generatedAt: generatedAt.toISOString(),
    totals: [
      { label: "Total Team Compensation", value: formatCents(totals.teamCompensationCents) },
      { label: "Member distributions (do not add to team total)", value: formatCents(totals.memberCompensationCents) },
    ],
    headers: ["Paid Month", "Team", "Group", "LOB", "Gross", "Team %", "Team Compensation", "Member", "Member Compensation"],
    rows: rows.map((row) => [
      formatStatementMonth(row.paidMonth),
      row.teamName,
      row.groupName,
      row.lineOfBusinessName,
      formatCents(row.grossCommissionCents),
      `${(row.teamAllocationBps / 100).toFixed(row.teamAllocationBps % 100 === 0 ? 0 : 2)}%`,
      formatCents(row.teamCompensationCents),
      row.memberName,
      formatCents(row.memberCompensationCents),
    ]),
  };
}

export function reportDocumentCsv(document: ReportDocument) {
  const meta = [
    [document.agencyName],
    [document.title],
    [document.period],
    [`Generated ${document.generatedAt}`],
    ...document.filtersUsed.map((line) => [line]),
    [],
    ...document.totals.map((total) => [total.label, total.value]),
    [],
  ];
  const table = toCsv(document.headers, document.rows);
  return `${meta.map((row) => toCsv([], [row]).replace(/^\n/, "")).join("\n")}\n${table}\n`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function isNumericReportHeader(header: string) {
  return /premium|gross|compensation|agency net|applicable %|team %|earned/i.test(header);
}

export function isNegativeReportCell(value: string) {
  return /^-\$|^-\d|\(\$/.test(value.trim());
}

export function groupedReportRows(document: ReportDocument) {
  const groups: Array<{ label: string; rows: string[][] }> = [];
  for (const row of document.rows) {
    const label = row[0] ?? "";
    const current = groups[groups.length - 1];
    if (!current || current.label !== label) groups.push({ label, rows: [row] });
    else current.rows.push(row);
  }
  return groups;
}

export function printableReportHtml(document: ReportDocument) {
  const generated = new Date(document.generatedAt).toLocaleString("en-US");
  const numeric = document.headers.map((header) => isNumericReportHeader(header));
  const groups = groupedReportRows(document);
  const bodyRows = groups.flatMap((group) => {
    const dataRows = group.rows.map((row) => `<tr>${row.map((cell, index) => {
      const classes = [
        numeric[index] ? "num" : "",
        numeric[index] && isNegativeReportCell(cell) ? "neg" : "",
      ].filter(Boolean).join(" ");
      return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(cell)}</td>`;
    }).join("")}</tr>`);
    if (groups.length < 2) return dataRows;
    return [`<tr class="group-label"><td colspan="${document.headers.length}">${escapeHtml(group.label)}</td></tr>`, ...dataRows];
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.agencyName)} · ${escapeHtml(document.title)}</title>
  <style>
    @page { margin: 0.6in 0.65in; }
    ${printableSuiteStyles()}
    @media print {
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      .summary { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="letterhead">
    <div class="agency"><span class="brand-mark">M</span>${escapeHtml(document.agencyName)}</div>
    <h1>${escapeHtml(document.title)}</h1>
    <p class="meta">${escapeHtml(document.period)} · Generated ${escapeHtml(generated)}</p>
  </header>
  <div class="filters">${document.filtersUsed.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
  <div class="summary">${document.totals.map((total) => `<div><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.value)}</strong></div>`).join("")}</div>
  <table>
    <thead><tr>${document.headers.map((header, index) => `<th${numeric[index] ? ' class="num"' : ""}>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${bodyRows.join("")}</tbody>
  </table>
  <footer>Confidential · ${escapeHtml(document.agencyName)} commission report · Totals use posted snapshots</footer>
</body>
</html>`;
}
