import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SHARE_PERCENT_UNAVAILABLE, agencyExecutiveSummary } from "@/domain/reportPresentation";
import { ReportsWorkspace } from "./ReportsWorkspace";

const stamp = "2026-09-01T00:00:00.000Z";

describe("rendered Reports workspace", () => {
  it("does not render an Agency dataset as an Individual Commission Report", () => {
    const html = renderToStaticMarkup(createElement(ReportsWorkspace, {
      groups: [],
      carriers: [],
      linesOfBusiness: [],
      agents: [{
        id: 7,
        name: "John Elizondo",
        defaultCompensationBps: null,
        notes: null,
        createdAt: stamp,
        updatedAt: stamp,
      }],
      accountManagers: [],
      teams: [],
      initialReport: {
        filters: { kind: "agency" },
        names: {},
        rows: [{
            paidMonth: "2026-08",
            coverageMonth: "2026-07",
          groupId: 1,
          groupName: "ABC COMPANY",
          carrierId: 1,
          carrierName: "Choice Builder",
          lineOfBusinessId: 1,
          lineOfBusinessName: "Medical",
          premiumCents: 100000,
          grossCommissionCents: 10000,
          compensationDistributedCents: 7000,
          agencyNetCents: 3000,
        }],
        totals: { grossCommissionCents: 10000 },
        document: {
          title: "Agency Commission Report",
          period: "2026-08",
          totals: [{ label: "Total Agency Net", value: "$30.00" }],
        },
      },
    }));
    expect(html).toContain("Individual Commission Report");
    expect(html).toContain("John Elizondo");
    expect(html).toContain("Agency Commission Report");
    expect(html).toContain("Coverage Month");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Recipient split %");
  });

  it("keys Top Client rows by stable Group ID, including duplicate display names", () => {
    const html = renderToStaticMarkup(createElement(ReportsWorkspace, {
      groups: [],
      carriers: [],
      linesOfBusiness: [],
      agents: [],
      accountManagers: [],
      teams: [],
      initialReport: {
        filters: { kind: "agency" },
        names: {},
        rows: [
          {
            paidMonth: "2026-09",
            groupId: 8,
            groupName: "Acme",
            carrierId: 1,
            carrierName: "Choice Builder",
            lineOfBusinessId: 1,
            lineOfBusinessName: "Medical",
            premiumCents: 0,
            grossCommissionCents: 5000,
            compensationDistributedCents: 0,
            agencyNetCents: 5000,
          },
          {
            paidMonth: "2026-09",
            groupId: 2,
            groupName: "Acme",
            carrierId: 1,
            carrierName: "Choice Builder",
            lineOfBusinessId: 1,
            lineOfBusinessName: "Medical",
            premiumCents: 0,
            grossCommissionCents: 5000,
            compensationDistributedCents: 0,
            agencyNetCents: 5000,
          },
        ],
        totals: { grossCommissionCents: 10000 },
        document: {
          title: "Agency Commission Report",
          period: "2026-09",
          totals: [{ label: "Total Commission Received", value: "$100.00" }],
        },
        executive: {
          carrierBreakdown: { rows: [{ id: 1, name: "Choice Builder", cents: 10000, percent: "100.0%" }], totalCents: 10000, totalPercent: "100.0%" },
          topClients: {
            rows: [
              { id: 2, name: "Acme", cents: 5000, percent: "50.0%" },
              { id: 8, name: "Acme", cents: 5000, percent: "50.0%" },
            ],
            combinedCents: 10000,
            combinedPercent: "100.0%",
          },
        },
      },
    }));
    expect(html).toContain('data-group-id="2"');
    expect(html).toContain('data-group-id="8"');
    expect(html.match(/data-group-id="/g)?.length).toBe(2);
    expect(html).toContain("Acme");
  });

  it("hides all Agency share percentages when the selected population includes a chargeback", () => {
    const rows = [
      {
        paidMonth: "2026-09",
        groupId: 1,
        groupName: "Client A",
        carrierId: 1,
        carrierName: "CaliforniaChoice",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Medical",
        premiumCents: 0,
        grossCommissionCents: 70000,
        compensationDistributedCents: 0,
        agencyNetCents: 70000,
      },
      {
        paidMonth: "2026-09",
        groupId: 2,
        groupName: "Client B",
        carrierId: 2,
        carrierName: "ChoiceBuilder",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Medical",
        premiumCents: 0,
        grossCommissionCents: 40000,
        compensationDistributedCents: 0,
        agencyNetCents: 40000,
      },
      {
        paidMonth: "2026-09",
        groupId: 3,
        groupName: "Chargeback",
        carrierId: 1,
        carrierName: "CaliforniaChoice",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Medical",
        premiumCents: 0,
        grossCommissionCents: -10000,
        compensationDistributedCents: 0,
        agencyNetCents: -10000,
      },
    ];
    const executive = agencyExecutiveSummary(rows, true, null);
    const html = renderToStaticMarkup(createElement(ReportsWorkspace, {
      groups: [],
      carriers: [],
      linesOfBusiness: [],
      agents: [],
      accountManagers: [],
      teams: [],
      initialReport: {
        filters: { kind: "agency" },
        names: {},
        rows,
        totals: { grossCommissionCents: 100000 },
        document: {
          title: "Agency Commission Report",
          period: "2026-09",
          totals: [{ label: "Total Commission Received", value: "$1,000.00" }],
        },
        executive,
      },
    }));
    expect(html).toContain("$700.00");
    expect(html).toContain("$400.00");
    expect(html).toContain("-$100.00");
    expect(html).not.toContain("70.0%");
    expect(html).not.toContain("40.0%");
    expect(html).not.toContain("60.0%");
    expect(html).not.toContain("100.0%");
    expect(html).toContain(SHARE_PERCENT_UNAVAILABLE);
  });

  it("prompts for recipient and paid month instead of showing a $0 individual report", () => {
    const html = renderToStaticMarkup(createElement(ReportsWorkspace, {
      groups: [],
      carriers: [],
      linesOfBusiness: [],
      agents: [],
      accountManagers: [],
      teams: [],
    }));
    expect(html).toContain("Choose a recipient and a paid month");
    expect(html).not.toContain("TOTAL PAYABLE");
    expect(html).not.toContain("$0.00");
  });
});
