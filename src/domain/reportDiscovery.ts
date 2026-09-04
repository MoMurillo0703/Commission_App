import { reportPeriodLabel, type ReportFilters } from "./reports";

export type ReportAvailability = {
  postedCommissionCount: number;
  availablePaidMonths: string[];
  matchingRowCount: number;
};

export function defaultReportFilters(kind: ReportFilters["kind"] = "agency"): ReportFilters {
  return {
    kind,
    paidMonth: null,
    startMonth: null,
    endMonth: null,
    ytd: false,
  };
}

export function reportEmptyMessage(filters: ReportFilters, availability: ReportAvailability) {
  if (availability.matchingRowCount > 0) return null;
  if (availability.postedCommissionCount === 0) {
    return "No posted commissions are on file yet.";
  }
  const period = reportPeriodLabel(filters);
  const months = availability.availablePaidMonths;
  const periodIsFiltered = Boolean(filters.paidMonth || filters.ytd || filters.startMonth || filters.endMonth);
  const entityFiltered = Boolean(filters.groupId || filters.carrierId || filters.lineOfBusinessId || filters.personId || filters.teamId || filters.accountManagerId || filters.primaryAgentId);
  if (!periodIsFiltered && !entityFiltered && (filters.kind === "individual" || filters.kind === "recipient" || filters.kind === "team")) {
    const count = availability.postedCommissionCount;
    const label = filters.kind === "team" ? "Team" : "Recipient";
    return `${count} posted commission${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} on file, but ${label} reporting only uses stored payout snapshots. Older commissions posted before payout snapshots existed are not invented here. Open the Agency report to review those commissions. New posts made after allocations are in place will appear on this report.`;
  }
  if (periodIsFiltered && months.length > 0) {
    const sample = months.length <= 4 ? months.join(", ") : `${months[0]} – ${months[months.length - 1]}`;
    return `No posted commissions match the current filters (${period}). Posted commissions exist in ${sample}. Clear the paid-month filter to see them.`;
  }
  return "No posted commissions match the current filters.";
}

export function reportAvailabilityFromMonths(months: string[], matchingRowCount: number): ReportAvailability {
  const availablePaidMonths = [...new Set(months.filter(Boolean))].sort();
  return {
    postedCommissionCount: months.length,
    availablePaidMonths,
    matchingRowCount,
  };
}
