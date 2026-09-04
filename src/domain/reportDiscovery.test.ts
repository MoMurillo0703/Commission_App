import { describe, expect, it } from "vitest";
import { defaultReportFilters, reportAvailabilityFromMonths, reportEmptyMessage } from "./reportDiscovery";
import { normalizeReportFilters } from "./reports";

describe("report discovery", () => {
  it("defaults to all paid months so posted data is not hidden", () => {
    const filters = defaultReportFilters("agency");
    expect(filters.paidMonth).toBeNull();
    expect(filters.ytd).toBe(false);
    expect(filters.startMonth).toBeNull();
    expect(normalizeReportFilters(filters).startMonth).toBeNull();
  });

  it("explains an empty filtered period when posted commissions exist elsewhere", () => {
    const availability = reportAvailabilityFromMonths(["2026-08", "2026-08"], 0);
    expect(availability.postedCommissionCount).toBe(2);
    expect(availability.availablePaidMonths).toEqual(["2026-08"]);
    const message = reportEmptyMessage(normalizeReportFilters({
      kind: "agency",
      paidMonth: "2026-09",
    }), availability);
    expect(message).toMatch(/No posted commissions match the current filters/);
    expect(message).toMatch(/2026-08/);
    expect(reportEmptyMessage(normalizeReportFilters({ kind: "agency" }), {
      postedCommissionCount: 0,
      availablePaidMonths: [],
      matchingRowCount: 0,
    })).toMatch(/on file yet/);
    expect(reportEmptyMessage(normalizeReportFilters({ kind: "individual" }), {
      postedCommissionCount: 49,
      availablePaidMonths: ["2026-08"],
      matchingRowCount: 0,
    })).toMatch(/payout snapshots/i);
    expect(reportEmptyMessage(normalizeReportFilters({ kind: "individual" }), {
      postedCommissionCount: 49,
      availablePaidMonths: ["2026-08"],
      matchingRowCount: 0,
    })).toMatch(/not invented|before payout snapshots/i);
  });
});
