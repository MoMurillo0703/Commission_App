import { formatPaidMonthLong, formatStatementMonth } from "./dates";
import { formatCents } from "./money";
import { formatAllocationPercent } from "./recipientStatement";
import {
  sumAgencyReport,
  sumIndividualReport,
  type AgencyReportRow,
  type IndividualReportRow,
} from "./reports";

export function isRecipientCompensationPayout(payout: { recipientType: string }) {
  return payout.recipientType === "person" || payout.recipientType === "team_member";
}

export function recipientCompensationMethod(recipientType: string): "direct" | "team" | null {
  if (recipientType === "person") return "direct";
  if (recipientType === "team_member") return "team";
  return null;
}

export function informalRecipientName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "Recipient";
  if (trimmed.includes(",")) {
    const after = trimmed.split(",")[1]?.trim();
    if (after) return after.split(/\s+/)[0] || trimmed;
  }
  return trimmed.split(/\s+/)[0] || "Recipient";
}

export function recipientShareLabel(row: Pick<IndividualReportRow, "allocationBps" | "recipientMethod">) {
  const percent = formatAllocationPercent(row.allocationBps);
  return row.recipientMethod === "team" ? `${percent} Team` : percent;
}

export const SHARE_PERCENT_UNAVAILABLE = "—";

export function sharePercentIsAvailable(partCents: number, wholeCents: number) {
  if (!Number.isInteger(partCents) || !Number.isInteger(wholeCents)) return false;
  if (wholeCents <= 0) return false;
  if (partCents < 0) return false;
  if (partCents > wholeCents) return false;
  return true;
}

export function formatShareOfTotal(partCents: number, wholeCents: number) {
  if (!sharePercentIsAvailable(partCents, wholeCents)) return SHARE_PERCENT_UNAVAILABLE;
  return `${(Math.round((partCents * 1000) / wholeCents) / 10).toFixed(1)}%`;
}

export function compareSignedAmountThenId(
  left: { id: number; cents: number },
  right: { id: number; cents: number },
) {
  return right.cents - left.cents || left.id - right.id;
}

export function topClientRowKey(groupId: number) {
  return `group:${groupId}`;
}

export type IndividualGroupSection = {
  groupId: number;
  groupName: string;
  subtitle: string | null;
  rows: IndividualReportRow[];
  agencyCommissionCents: number;
  recipientCompensationCents: number;
};

function uniqueGross(rows: IndividualReportRow[]) {
  return sumIndividualReport(rows).grossCommissionCents;
}

function groupSubtitle(rows: IndividualReportRow[]) {
  if (rows.length === 0) return null;
  const methods = new Set(rows.map((row) => row.recipientMethod ?? (row.teamName ? "team" : "direct")));
  const percents = new Set(rows.map((row) => row.allocationBps));
  const carriers = new Set(rows.map((row) => row.carrierName));
  const teams = new Set(rows.map((row) => row.teamName).filter(Boolean));
  if (methods.size === 1 && percents.size === 1 && carriers.size === 1) {
    const method = [...methods][0];
    const percent = formatAllocationPercent([...percents][0]!);
    const carrier = [...carriers][0]!;
    if (method === "team") {
      const team = [...teams][0];
      return `${team ? `${team} · ` : ""}Team Split ${percent} · ${carrier}`;
    }
    return `Direct ${percent} · ${carrier}`;
  }
  return null;
}

export function groupIndividualReportRows(rows: IndividualReportRow[]): IndividualGroupSection[] {
  const byGroup = new Map<number, IndividualReportRow[]>();
  const order: number[] = [];
  const sorted = [...rows].sort((left, right) => (
    left.groupName.localeCompare(right.groupName)
    || left.carrierName.localeCompare(right.carrierName)
    || left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)
    || (left.premiumMonth ?? "").localeCompare(right.premiumMonth ?? "")
    || (left.commissionId ?? 0) - (right.commissionId ?? 0)
    || (left.payoutId ?? 0) - (right.payoutId ?? 0)
  ));
  for (const row of sorted) {
    const current = byGroup.get(row.groupId);
    if (current) current.push(row);
    else {
      byGroup.set(row.groupId, [row]);
      order.push(row.groupId);
    }
  }
  return order.map((groupId) => {
    const groupRows = byGroup.get(groupId) ?? [];
    return {
      groupId,
      groupName: groupRows[0]?.groupName ?? "",
      subtitle: groupSubtitle(groupRows),
      rows: groupRows,
      agencyCommissionCents: uniqueGross(groupRows),
      recipientCompensationCents: groupRows.reduce((sum, row) => sum + row.compensationCents, 0),
    };
  });
}

export function individualStatementSummary(
  rows: IndividualReportRow[],
  totals: { compensationCents: number; grossCommissionCents?: number },
  recipientName: string,
  period: string,
) {
  const groups = groupIndividualReportRows(rows);
  const informal = informalRecipientName(recipientName);
  const agencyGross = totals.grossCommissionCents ?? uniqueGross(rows);
  return {
    heading: recipientName.trim().toUpperCase(),
    subheading: `Commission Statement — ${period}`,
    informalName: informal,
    groupCount: groups.length,
    transactionCount: rows.length,
    agencyCommissionCents: agencyGross,
    recipientCompensationCents: totals.compensationCents,
    groups,
    cards: [
      { label: "Agency Commission Represented", value: formatCents(agencyGross) },
      { label: `${informal}'s Compensation`, value: formatCents(totals.compensationCents) },
      { label: "Groups", value: String(groups.length) },
      { label: "Transactions", value: String(rows.length) },
    ],
    grandTotals: [
      { label: "Groups", value: String(groups.length) },
      { label: "Transactions", value: String(rows.length) },
      { label: "Agency Commission Represented", value: formatCents(agencyGross) },
      { label: `TOTAL PAYABLE TO ${recipientName.trim().toUpperCase()}`, value: formatCents(totals.compensationCents) },
    ],
  };
}

export function individualTransactionCells(row: IndividualReportRow, informalName: string) {
  return {
    carrier: row.carrierName,
    lob: row.lineOfBusinessName,
    coverageMonth: row.premiumMonth ? formatStatementMonth(row.premiumMonth) : "—",
    agencyCommission: formatCents(row.grossCommissionCents),
    share: recipientShareLabel(row),
    recipientCommission: formatCents(row.compensationCents),
    shareHeader: `${informalName}'s %`,
    recipientHeader: `${informalName}'s Comm`,
  };
}

export type NamedAmountShare = {
  id: number;
  name: string;
  cents: number;
  percent: string;
};

export function agencyCarrierBreakdown(rows: AgencyReportRow[]): {
  rows: NamedAmountShare[];
  totalCents: number;
} {
  const totals = new Map<number, { name: string; cents: number }>();
  for (const row of rows) {
    const current = totals.get(row.carrierId) ?? { name: row.carrierName, cents: 0 };
    current.cents += row.grossCommissionCents;
    totals.set(row.carrierId, current);
  }
  const totalCents = [...totals.values()].reduce((sum, row) => sum + row.cents, 0);
  const ranked = [...totals.entries()]
    .map(([id, row]) => ({ id, name: row.name, cents: row.cents, percent: formatShareOfTotal(row.cents, totalCents) }))
    .sort(compareSignedAmountThenId);
  return { rows: ranked, totalCents };
}

export function agencyTopClients(rows: AgencyReportRow[], limit = 5): {
  rows: NamedAmountShare[];
  combinedCents: number;
  combinedPercent: string;
  selectedGrossCents: number;
} {
  const totals = new Map<number, { name: string; cents: number }>();
  for (const row of rows) {
    const current = totals.get(row.groupId) ?? { name: row.groupName, cents: 0 };
    current.cents += row.grossCommissionCents;
    totals.set(row.groupId, current);
  }
  const selectedGrossCents = sumAgencyReport(rows).grossCommissionCents;
  const ranked = [...totals.entries()]
    .map(([id, row]) => ({ id, name: row.name, cents: row.cents }))
    .sort(compareSignedAmountThenId)
    .slice(0, limit)
    .map((row) => ({ ...row, percent: formatShareOfTotal(row.cents, selectedGrossCents) }));
  const combinedCents = ranked.reduce((sum, row) => sum + row.cents, 0);
  return {
    rows: ranked,
    combinedCents,
    combinedPercent: formatShareOfTotal(combinedCents, selectedGrossCents),
    selectedGrossCents,
  };
}

export function agencyExecutiveSummary(rows: AgencyReportRow[], payableReady: boolean, payableMessage: string | null) {
  const totals = sumAgencyReport(rows);
  const groups = new Set(rows.map((row) => row.groupId));
  const carriers = new Set(rows.map((row) => row.carrierId));
  const carrierBreakdown = agencyCarrierBreakdown(rows);
  const topClients = agencyTopClients(rows);
  return {
    totals,
    groupCount: groups.size,
    carrierCount: carriers.size,
    payableReady,
    payableStatus: payableReady ? "PAYABLE-READY" : (payableMessage ?? "NOT PAYABLE-READY"),
    carrierBreakdown,
    topClients,
    cards: [
      { label: "Total Commission Received", value: formatCents(totals.grossCommissionCents) },
      { label: "Groups Paid", value: String(groups.size) },
      { label: "Carriers Paid", value: String(carriers.size) },
      { label: "Payable Status", value: payableReady ? "PAYABLE-READY" : "NOT PAYABLE-READY" },
    ],
  };
}

export function commissionStatementPeriod(period: string) {
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return formatPaidMonthLong(period);
  return period;
}
