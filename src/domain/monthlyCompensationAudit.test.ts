import { describe, expect, it } from "vitest";
import { monthlyAuditStatusCopy, monthlyAuditSummaryRows } from "./monthlyCompensationAudit";

describe("monthly compensation audit copy", () => {
  it("uses business-facing labels and does not expose implementation jargon", () => {
    expect(monthlyAuditStatusCopy(true, null)).toMatch(/reconciles to the appropriate people/i);
    expect(monthlyAuditStatusCopy(false, "NOT PAYABLE-READY — Agency owner is not configured for August 2026.")).toBe(
      "This paid month needs review. Agency owner is not configured for August 2026.",
    );
    const rows = monthlyAuditSummaryRows({
      postedCommissionCount: 2,
      grossCents: 10000,
      moAgencyCents: 2000,
      named: [{ label: "John", cents: 7000 }],
      otherCents: 0,
      fallbackAgencyCents: 800,
      legacyNoPayoutCents: 200,
      inconsistentCents: 0,
      underDistributedCents: 0,
      overDistributedCents: 0,
      unclassifiedCents: 0,
      differenceCents: 0,
    });
    const labels = rows.map((row) => row.label).join(" ");
    expect(labels).toContain("Needs review — historical Agency records");
    expect(labels).toContain("Needs review — missing payout snapshot");
    expect(labels).not.toMatch(/Team parents/i);
    expect(labels).not.toMatch(/LEGACY — NO PAYOUT SNAPSHOT/i);
    expect(labels).not.toMatch(/Historical Agency Fallback/i);
  });
});
