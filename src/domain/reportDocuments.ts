import { printableSuiteStyles } from "@/theme/tokens";
import { formatCents } from "./money";
import { formatStatementMonth } from "./dates";
import {
  recipientStatementDisclaimer,
  sourceCommissionIds,
} from "./recipientStatement";
import {
  reportPeriodLabel,
  sumIndividualReport,
  type AgencyReportRow,
  type IndividualReportRow,
  type ReportFilters,
  type ReportKind,
  type ReportTotals,
  type TeamReportRow,
  toCsv,
} from "./reports";
import {
  agencyExecutiveSummary,
  commissionStatementPeriod,
  individualStatementSummary,
  individualTransactionCells,
  type IndividualGroupSection,
} from "./reportPresentation";

export const AGENCY_NAME = "Murillo Insurance";

export type ReportDocumentSection = {
  title: string;
  subtitle?: string | null;
  headers: string[];
  rows: string[][];
  totals?: Array<{ cells: string[]; emphasis?: boolean }>;
};

export type ReportDocument = {
  agencyName: string;
  title: string;
  heading?: string;
  subheading?: string;
  period: string;
  filtersUsed: string[];
  generatedAt: string;
  totals: Array<{ label: string; value: string }>;
  headers: string[];
  rows: string[][];
  notes?: string[];
  sourceCommissionIds?: number[];
  layout?: "table" | "statement";
  summaryTables?: ReportDocumentSection[];
  groupSections?: ReportDocumentSection[];
  footerTotals?: Array<{ label: string; value: string }>;
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
  if (filters.kind === "individual" || filters.kind === "recipient") lines.push(`Recipient: ${names.personName || "All people"}`);
  if (filters.kind === "team") lines.push(`Team: ${names.teamName || "All teams"}`);
  lines.push(`Account manager: ${names.accountManagerName || "All"}`);
  lines.push(`Primary agent: ${names.primaryAgentName || "All"}`);
  return lines;
}

function isRecipientStatement(filters: ReportFilters) {
  return filters.kind === "recipient" || Boolean(filters.kind === "individual" && filters.personId);
}

function reportTitle(kind: ReportKind, filters?: ReportFilters) {
  if (kind === "agency") return "Agency Commission Report";
  if (kind === "recipient" || (kind === "individual" && filters && isRecipientStatement(filters))) {
    return "Individual Commission Report";
  }
  if (kind === "individual") return "Individual Commission Report";
  return "Team Compensation Report";
}

export function agencyReportDocument(
  rows: AgencyReportRow[],
  totals: ReportTotals,
  filters: ReportFilters,
  names: Parameters<typeof filterLines>[1],
  generatedAt = new Date(),
  payable?: { payableReady: boolean; message?: string | null },
): ReportDocument {
  const executive = agencyExecutiveSummary(rows, payable?.payableReady ?? true, payable?.message ?? null);
  const carrierRows = executive.carrierBreakdown.rows.map((row) => [
    row.name,
    formatCents(row.cents),
    row.percent,
  ]);
  const topRows = executive.topClients.rows.map((row) => [
    row.name,
    formatCents(row.cents),
    row.percent,
  ]);
  return {
    agencyName: AGENCY_NAME,
    title: reportTitle("agency"),
    heading: "Agency Commission Report",
    subheading: commissionStatementPeriod(reportPeriodLabel(filters)),
    period: reportPeriodLabel(filters),
    filtersUsed: filterLines(filters, names),
    generatedAt: generatedAt.toISOString(),
    layout: "statement",
    totals: [
      { label: "Total Commission Received", value: formatCents(totals.grossCommissionCents) },
      { label: "Groups Paid", value: String(executive.groupCount) },
      { label: "Carriers Paid", value: String(executive.carrierCount) },
      { label: "Payable Status", value: executive.payableStatus },
    ],
    summaryTables: [
      {
        title: "Carrier Breakdown",
        headers: ["Carrier", "Commission", "% of Month"],
        rows: carrierRows,
        totals: [{
          cells: ["TOTAL", formatCents(executive.carrierBreakdown.totalCents), executive.carrierBreakdown.totalPercent],
          emphasis: true,
        }],
      },
      {
        title: "Top 5 Clients This Month",
        headers: ["Client", "Commission", "% of Month"],
        rows: topRows,
        totals: [{
          cells: ["TOP 5 TOTAL", formatCents(executive.topClients.combinedCents), executive.topClients.combinedPercent],
          emphasis: true,
        }],
      },
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

function individualGroupSection(section: IndividualGroupSection, informalName: string): ReportDocumentSection {
  const shareHeader = `${informalName}'s %`;
  const recipientHeader = `${informalName}'s Comm`;
  return {
    title: section.groupName,
    subtitle: section.subtitle,
    headers: ["Carrier", "LOB", "Coverage Month", "Agency Comm", shareHeader, recipientHeader],
    rows: section.rows.map((row) => {
      const cells = individualTransactionCells(row, informalName);
      return [cells.carrier, cells.lob, cells.coverageMonth, cells.agencyCommission, cells.share, cells.recipientCommission];
    }),
    totals: [{
      cells: ["GROUP TOTAL", "", "", formatCents(section.agencyCommissionCents), "", formatCents(section.recipientCompensationCents)],
      emphasis: true,
    }],
  };
}

export function individualReportDocument(
  rows: IndividualReportRow[],
  totals: { compensationCents: number; grossCommissionCents?: number },
  filters: ReportFilters,
  names: Parameters<typeof filterLines>[1],
  recipientName: string,
  generatedAt = new Date(),
): ReportDocument {
  const recipient = isRecipientStatement({ ...filters, kind: filters.kind === "recipient" ? "recipient" : "individual" });
  const commissionIds = sourceCommissionIds(rows);
  const agencyGross = totals.grossCommissionCents ?? sumIndividualReport(rows).grossCommissionCents;
  const period = reportPeriodLabel(filters);
  const statement = individualStatementSummary(rows, { ...totals, grossCommissionCents: agencyGross }, recipientName, commissionStatementPeriod(period));
  const informal = statement.informalName;
  return {
    agencyName: AGENCY_NAME,
    title: reportTitle(recipient ? "recipient" : "individual", filters),
    heading: statement.heading,
    subheading: statement.subheading,
    period,
    filtersUsed: filterLines({ ...filters, kind: recipient ? "recipient" : "individual" }, { ...names, personName: recipientName }),
    generatedAt: generatedAt.toISOString(),
    layout: "statement",
    notes: recipient ? [
      recipientStatementDisclaimer(),
    ] : undefined,
    sourceCommissionIds: commissionIds,
    totals: statement.cards,
    footerTotals: statement.grandTotals,
    groupSections: statement.groups.map((group) => individualGroupSection(group, informal)),
    headers: ["Group", "Carrier", "LOB", "Coverage Month", "Agency Comm", `${informal}'s %`, `${informal}'s Comm`],
    rows: statement.groups.flatMap((group) => group.rows.map((row) => {
      const cells = individualTransactionCells(row, informal);
      return [group.groupName, cells.carrier, cells.lob, cells.coverageMonth, cells.agencyCommission, cells.share, cells.recipientCommission];
    })),
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
    ...(document.notes ?? []).map((line) => [line]),
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
  return /premium|gross|compensation|agency net|applicable %|team %|earned|payable|amount|id|comm|% of month|groups|transactions/i.test(header)
    && !/^carrier$|^client$|^group$|^lob$/i.test(header);
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

function renderHtmlTable(section: { headers: string[]; rows: string[][]; totals?: Array<{ cells: string[]; emphasis?: boolean }> }) {
  const numeric = section.headers.map((header) => isNumericReportHeader(header));
  const body = section.rows.map((row) => `<tr>${row.map((cell, index) => {
    const classes = [
      numeric[index] ? "num" : "",
      numeric[index] && isNegativeReportCell(cell) ? "neg" : "",
    ].filter(Boolean).join(" ");
    return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(cell)}</td>`;
  }).join("")}</tr>`);
  const footer = (section.totals ?? []).map((total) => `<tr class="group-total">${total.cells.map((cell, index) => {
    const classes = [
      numeric[index] ? "num" : "",
      numeric[index] && isNegativeReportCell(cell) ? "neg" : "",
    ].filter(Boolean).join(" ");
    return `<td${classes ? ` class="${classes}"` : ""}>${escapeHtml(cell)}</td>`;
  }).join("")}</tr>`);
  return `<table>
    <thead><tr>${section.headers.map((header, index) => `<th${numeric[index] ? ' class="num"' : ""}>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${[...body, ...footer].join("")}</tbody>
  </table>`;
}

export function printableReportHtml(document: ReportDocument) {
  const generated = new Date(document.generatedAt).toLocaleString("en-US");
  const statement = document.layout === "statement";
  const numeric = document.headers.map((header) => isNumericReportHeader(header));
  const groups = groupedReportRows(document);
  const fallbackRows = groups.flatMap((group) => {
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
  const summaryHtml = (document.summaryTables ?? []).map((section) => `
    <section class="report-block">
      <h2>${escapeHtml(section.title)}</h2>
      ${renderHtmlTable(section)}
    </section>`).join("");
  const groupHtml = (document.groupSections ?? []).map((section) => `
    <section class="report-block">
      <h2>${escapeHtml(section.title)}</h2>
      ${section.subtitle ? `<p class="meta">${escapeHtml(section.subtitle)}</p>` : ""}
      ${renderHtmlTable(section)}
    </section>`).join("");
  const footerHtml = document.footerTotals?.length
    ? `<section class="grand-total"><h2>Grand Total</h2><div class="summary">${document.footerTotals.map((total) => `<div><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.value)}</strong></div>`).join("")}</div></section>`
    : "";
  const detailHtml = statement && (document.groupSections?.length || document.summaryTables?.length)
    ? `${summaryHtml}${groupHtml}`
    : `<table>
    <thead><tr>${document.headers.map((header, index) => `<th${numeric[index] ? ' class="num"' : ""}>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${fallbackRows.join("")}</tbody>
  </table>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.agencyName)} · ${escapeHtml(document.heading ?? document.title)}</title>
  <style>
    @page { margin: 0.55in 0.6in; }
    ${printableSuiteStyles()}
    .report-block { margin: 0 0 18px; break-inside: avoid; }
    .report-block h2 { font-size: 14px; margin: 0 0 4px; }
    .group-total td { font-weight: 700; border-top: 1px solid ${"#15233B"}; border-bottom: none; background: transparent; }
    .grand-total { margin-top: 8px; border-top: 2px solid ${"#15233B"}; padding-top: 12px; }
    @media print {
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      .summary, .report-block, .grand-total { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="letterhead">
    <div class="agency"><span class="brand-mark">M</span>${escapeHtml(document.agencyName)}</div>
    <h1>${escapeHtml(document.heading ?? document.title)}</h1>
    <p class="meta">${escapeHtml(document.subheading ?? document.period)} · Generated ${escapeHtml(generated)}</p>
  </header>
  <div class="filters">${document.filtersUsed.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
  ${document.notes?.length ? `<div class="filters">${document.notes.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>` : ""}
  <div class="summary">${document.totals.map((total) => `<div><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.value)}</strong></div>`).join("")}</div>
  ${detailHtml}
  ${footerHtml}
  <footer>Confidential · ${escapeHtml(document.agencyName)} commission report · Totals use posted snapshots</footer>
</body>
</html>`;
}
