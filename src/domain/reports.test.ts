import { describe, expect, it } from "vitest";
import {
  agencyReportDocument,
  individualReportDocument,
  printableReportHtml,
  reportDocumentCsv,
  teamReportDocument,
} from "./reportDocuments";
import {
  monthInReportRange,
  normalizeReportFilters,
  sumAgencyReport,
  sumIndividualReport,
  sumTeamReport,
  toCsv,
} from "./reports";

describe("report filters and totals", () => {
  it("normalizes paid month, date range, and YTD filters", () => {
    const month = normalizeReportFilters({ kind: "agency", paidMonth: "2026-09" });
    expect(month.startMonth).toBe("2026-09");
    expect(month.endMonth).toBe("2026-09");
    expect(monthInReportRange("2026-09", month)).toBe(true);
    expect(monthInReportRange("2026-08", month)).toBe(false);

    const range = normalizeReportFilters({ kind: "agency", startMonth: "2026-01", endMonth: "2026-03" });
    expect(monthInReportRange("2026-02", range)).toBe(true);
    expect(monthInReportRange("2026-04", range)).toBe(false);

    const ytd = normalizeReportFilters({ kind: "agency", ytd: true }, new Date("2026-09-02T12:00:00Z"));
    expect(ytd.startMonth).toBe("2026-01");
    expect(ytd.endMonth).toBe("2026-09");
  });

  it("totals agency, individual, and team reports without double-counting team members", () => {
    const agency = sumAgencyReport([
      { paidMonth: "2026-09", groupId: 1, groupName: "A", carrierId: 1, carrierName: "C", lineOfBusinessId: 1, lineOfBusinessName: "Medical", premiumCents: 100000, grossCommissionCents: 10000, compensationDistributedCents: 8000, agencyNetCents: 2000 },
      { paidMonth: "2026-09", groupId: 2, groupName: "B", carrierId: 1, carrierName: "C", lineOfBusinessId: 1, lineOfBusinessName: "Medical", premiumCents: 50000, grossCommissionCents: 4000, compensationDistributedCents: 3000, agencyNetCents: 1000 },
    ]);
    expect(agency).toEqual({
      premiumCents: 150000,
      grossCommissionCents: 14000,
      compensationDistributedCents: 11000,
      agencyNetCents: 3000,
      compensationCents: 11000,
    });

    const individual = sumIndividualReport([
      { paidMonth: "2026-09", groupId: 1, groupName: "A", carrierId: 1, carrierName: "C", lineOfBusinessId: 1, lineOfBusinessName: "Medical", recipientName: "John", personKind: "agent", personId: 1, teamName: null, grossCommissionCents: 10000, allocationBps: 7000, compensationCents: 7000 },
    ]);
    expect(individual.compensationCents).toBe(7000);

    const team = sumTeamReport([
      { paidMonth: "2026-09", teamId: 1, teamName: "CV", groupId: 1, groupName: "A", lineOfBusinessId: 1, lineOfBusinessName: "Medical", grossCommissionCents: 10000, teamAllocationBps: 2000, teamCompensationCents: 2000, memberName: "Laura", memberCompensationCents: 1000, memberAllocationBps: 1000 },
      { paidMonth: "2026-09", teamId: 1, teamName: "CV", groupId: 1, groupName: "A", lineOfBusinessId: 1, lineOfBusinessName: "Medical", grossCommissionCents: 10000, teamAllocationBps: 2000, teamCompensationCents: 2000, memberName: "Nancy", memberCompensationCents: 1000, memberAllocationBps: 1000 },
    ]);
    expect(team.teamCompensationCents).toBe(2000);
    expect(team.memberCompensationCents).toBe(2000);
    expect(team.grossCommissionCents).toBe(10000);
  });
});

describe("report documents", () => {
  const filters = normalizeReportFilters({ kind: "agency", paidMonth: "2026-09", groupId: 1 });
  const names = { groupName: "H R LABOR CONTRACTING", carrierName: "All", lineName: "Group Medical" };

  it("builds CSV, printable HTML, and formal report metadata", () => {
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
    }, filters, names, new Date("2026-09-03T17:00:00Z"));
    const csv = reportDocumentCsv(document);
    expect(csv).toMatch(/Murillo Insurance/);
    expect(csv).toMatch(/Agency Commission Report/);
    expect(csv).toMatch(/Total Agency Net/);
    expect(csv).toMatch(/H R LABOR CONTRACTING/);
    const html = printableReportHtml(document);
    expect(html).toMatch(/Murillo Insurance/);
    expect(html).toMatch(/@page/);
    expect(html).toMatch(/Generated/);
    expect(html).toMatch(/Total Gross Commission/);
    expect(toCsv(["A"], [["B,C"]])).toBe("A\n\"B,C\"");
  });

  it("builds individual and team documents from snapshot percentages", () => {
    const individual = individualReportDocument([{
      paidMonth: "2026-09",
      groupId: 1,
      groupName: "H R LABOR CONTRACTING",
      carrierId: 1,
      carrierName: "Choice Builder",
      lineOfBusinessId: 1,
      lineOfBusinessName: "Group Medical",
      recipientName: "John Elizando",
      personKind: "agent",
      personId: 1,
      teamName: null,
      grossCommissionCents: 10000,
      allocationBps: 7000,
      compensationCents: 7000,
    }], { compensationCents: 7000 }, { ...filters, kind: "individual" }, names, "John Elizando");
    expect(individual.rows[0]?.[5]).toBe("70%");
    const team = teamReportDocument([{
      paidMonth: "2026-09",
      teamId: 1,
      teamName: "Central Valley Team",
      groupId: 1,
      groupName: "H R LABOR CONTRACTING",
      lineOfBusinessId: 1,
      lineOfBusinessName: "Group Medical",
      grossCommissionCents: 10000,
      teamAllocationBps: 2000,
      teamCompensationCents: 2000,
      memberName: "Laura",
      memberCompensationCents: 1000,
      memberAllocationBps: 1000,
    }], { teamCompensationCents: 2000, memberCompensationCents: 1000 }, { ...filters, kind: "team" }, { ...names, teamName: "Central Valley Team" });
    expect(team.totals[0]?.value).toMatch(/\$20\.00/);
  });
});
