import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Recipient split %");
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
