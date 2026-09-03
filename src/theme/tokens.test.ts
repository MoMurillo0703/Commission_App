import { describe, expect, it } from "vitest";
import { printableReportHtml, agencyReportDocument } from "@/domain/reportDocuments";
import { normalizeReportFilters } from "@/domain/reports";
import { murilloTheme, murilloThemeAliases, printableSuiteStyles } from "./tokens";

describe("Murillo Insurance suite theme", () => {
  it("defines reusable semantic tokens for the suite palette", () => {
    expect(murilloTheme.navy).toMatch(/^#15233B$/i);
    expect(murilloTheme.accent).toMatch(/^#C07A3A$/i);
    expect(murilloTheme.page).toMatch(/^#/);
    expect(murilloTheme.surface).toMatch(/^#/);
    expect(murilloTheme.border).toMatch(/^#/);
    expect(murilloTheme.text).toBe(murilloTheme.navy);
    expect(murilloTheme.textMuted).toMatch(/^#/);
    expect(murilloTheme.actionPrimary).toBe(murilloTheme.navy);
    expect(murilloTheme.actionSecondary).toMatch(/^#/);
    expect(murilloTheme.success).toMatch(/^#/);
    expect(murilloTheme.warning).toMatch(/^#/);
    expect(murilloTheme.error).toMatch(/^#/);
    expect(murilloTheme.navActive).toMatch(/^#/);
    expect(murilloTheme.tableHeader).toMatch(/^#/);
    expect(murilloTheme.rowAlt).toMatch(/^#/);
    expect(murilloThemeAliases.paper).toBe(murilloTheme.page);
    expect(murilloTheme.actionPrimary).not.toBe(murilloTheme.accent);
  });

  it("applies suite colors to printable reports without changing totals", () => {
    const filters = normalizeReportFilters({ kind: "agency", paidMonth: "2026-09" });
    const document = agencyReportDocument([{
      paidMonth: "2026-09",
      groupId: 1,
      groupName: "H R LABOR CONTRACTING",
      carrierId: 1,
      carrierName: "Choice Builder",
      lineOfBusinessId: 1,
      lineOfBusinessName: "Group Medical",
      premiumCents: 100000,
      grossCommissionCents: 10000,
      compensationDistributedCents: 8000,
      agencyNetCents: 2000,
    }], {
      premiumCents: 100000,
      grossCommissionCents: 10000,
      compensationDistributedCents: 8000,
      agencyNetCents: 2000,
      compensationCents: 8000,
    }, filters, { groupName: "H R LABOR CONTRACTING" }, new Date("2026-09-03T17:00:00Z"));
    const html = printableReportHtml(document);
    expect(html).toContain(murilloTheme.navy);
    expect(html).toContain(murilloTheme.accentText);
    expect(html).not.toMatch(/#1e6657/i);
    expect(html).toMatch(/\$100\.00/);
    expect(html).toMatch(/\$20\.00/);
    expect(document.totals[3]?.value).toBe("$20.00");
    expect(printableSuiteStyles()).toContain(murilloTheme.navy);
  });
});
