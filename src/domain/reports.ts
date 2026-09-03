import { currentPaidMonth, isPaidMonth } from "./dates";

export type ReportKind = "agency" | "individual" | "team";

export type ReportFilters = {
  kind: ReportKind;
  paidMonth?: string | null;
  startMonth?: string | null;
  endMonth?: string | null;
  ytd?: boolean;
  groupId?: number | null;
  carrierId?: number | null;
  lineOfBusinessId?: number | null;
  personKind?: "agent" | "account_manager" | null;
  personId?: number | null;
  teamId?: number | null;
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
};

export type AgencyReportRow = {
  paidMonth: string;
  groupId: number;
  groupName: string;
  carrierId: number;
  carrierName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  premiumCents: number | null;
  grossCommissionCents: number;
  compensationDistributedCents: number;
  agencyNetCents: number;
};

export type IndividualReportRow = {
  paidMonth: string;
  groupId: number;
  groupName: string;
  carrierId: number;
  carrierName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  recipientName: string;
  personKind: "agent" | "account_manager" | null;
  personId: number | null;
  teamName: string | null;
  grossCommissionCents: number;
  allocationBps: number;
  compensationCents: number;
};

export type TeamReportRow = {
  snapshotKey?: string;
  paidMonth: string;
  teamId: number;
  teamName: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  teamAllocationBps: number;
  teamCompensationCents: number;
  memberName: string;
  memberCompensationCents: number;
  memberAllocationBps: number;
};

export type ReportTotals = {
  premiumCents: number;
  grossCommissionCents: number;
  compensationDistributedCents: number;
  agencyNetCents: number;
  compensationCents: number;
};

export function yearToDateRange(asOf = new Date()) {
  const year = asOf.getFullYear();
  return { startMonth: `${year}-01`, endMonth: currentPaidMonth(asOf) };
}

export function normalizeReportFilters(input: ReportFilters, asOf = new Date()): ReportFilters {
  const ytd = Boolean(input.ytd);
  const paidMonth = isPaidMonth(input.paidMonth) ? input.paidMonth : null;
  let startMonth = isPaidMonth(input.startMonth) ? input.startMonth : null;
  let endMonth = isPaidMonth(input.endMonth) ? input.endMonth : null;
  if (ytd) {
    const range = yearToDateRange(asOf);
    startMonth = range.startMonth;
    endMonth = range.endMonth;
  } else if (paidMonth) {
    startMonth = paidMonth;
    endMonth = paidMonth;
  }
  return {
    ...input,
    paidMonth,
    startMonth,
    endMonth,
    ytd,
    groupId: input.groupId ?? null,
    carrierId: input.carrierId ?? null,
    lineOfBusinessId: input.lineOfBusinessId ?? null,
    personKind: input.personKind ?? null,
    personId: input.personId ?? null,
    teamId: input.teamId ?? null,
    accountManagerId: input.accountManagerId ?? null,
    primaryAgentId: input.primaryAgentId ?? null,
  };
}

export function reportPeriodLabel(filters: ReportFilters) {
  if (filters.ytd && filters.startMonth && filters.endMonth) {
    return `YTD ${filters.startMonth} – ${filters.endMonth}`;
  }
  if (filters.paidMonth) return filters.paidMonth;
  if (filters.startMonth && filters.endMonth) return `${filters.startMonth} – ${filters.endMonth}`;
  if (filters.startMonth) return `${filters.startMonth} – present`;
  if (filters.endMonth) return `through ${filters.endMonth}`;
  return "All paid months";
}

export function monthInReportRange(month: string, filters: ReportFilters) {
  if (filters.startMonth && month < filters.startMonth) return false;
  if (filters.endMonth && month > filters.endMonth) return false;
  return true;
}

export function sumAgencyReport(rows: AgencyReportRow[]): ReportTotals {
  return rows.reduce((totals, row) => ({
    premiumCents: totals.premiumCents + (row.premiumCents ?? 0),
    grossCommissionCents: totals.grossCommissionCents + row.grossCommissionCents,
    compensationDistributedCents: totals.compensationDistributedCents + row.compensationDistributedCents,
    agencyNetCents: totals.agencyNetCents + row.agencyNetCents,
    compensationCents: totals.compensationCents + row.compensationDistributedCents,
  }), {
    premiumCents: 0,
    grossCommissionCents: 0,
    compensationDistributedCents: 0,
    agencyNetCents: 0,
    compensationCents: 0,
  });
}

export function sumIndividualReport(rows: IndividualReportRow[]) {
  return {
    grossCommissionCents: rows.reduce((sum, row) => sum + row.grossCommissionCents, 0),
    compensationCents: rows.reduce((sum, row) => sum + row.compensationCents, 0),
  };
}

export function sumTeamReport(rows: TeamReportRow[]) {
  const teamKeys = new Set<string>();
  let teamCompensationCents = 0;
  let grossCommissionCents = 0;
  for (const row of rows) {
    const key = row.snapshotKey ?? `${row.paidMonth}:${row.teamId}:${row.groupId}:${row.lineOfBusinessId}`;
    if (!teamKeys.has(key)) {
      teamKeys.add(key);
      teamCompensationCents += row.teamCompensationCents;
      grossCommissionCents += row.grossCommissionCents;
    }
  }
  return {
    grossCommissionCents,
    teamCompensationCents,
    memberCompensationCents: rows.reduce((sum, row) => sum + row.memberCompensationCents, 0),
  };
}

export function csvEscape(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  if (/^[=+@]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return [headers.map(csvEscape).join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}
