import { describe, expect, it } from "vitest";
import { individualReportDocument, printableReportHtml } from "./reportDocuments";
import { exportReportDocument } from "@/data/reportExport";
import {
  agencyCarrierBreakdown,
  agencyExecutiveSummary,
  agencyTopClients,
  groupIndividualReportRows,
  informalRecipientName,
  isRecipientCompensationPayout,
  recipientCompensationMethod,
  recipientShareLabel,
} from "./reportPresentation";
import { normalizeReportFilters, sumIndividualReport, type AgencyReportRow, type IndividualReportRow } from "./reports";

function individualRow(overrides: Partial<IndividualReportRow> = {}): IndividualReportRow {
  return {
    paidMonth: "2026-09",
    groupId: 1,
    groupName: "H & R LABOR CONTRACTING INC",
    carrierId: 1,
    carrierName: "ChoiceBuilder",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Dental",
    recipientName: "John Elizando",
    recipientMethod: "team",
    personKind: "agent",
    personId: 1,
    teamName: "Cal Choice Team",
    grossCommissionCents: 4659,
    allocationBps: 7000,
    teamInternalBps: 7000,
    compensationCents: 3261,
    commissionId: 10,
    payoutId: 100,
    premiumMonth: "2026-09",
    ...overrides,
  };
}

function agencyRow(overrides: Partial<AgencyReportRow> = {}): AgencyReportRow {
  return {
    paidMonth: "2026-09",
    groupId: 1,
    groupName: "Client A",
    carrierId: 1,
    carrierName: "CaliforniaChoice",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Medical",
    premiumCents: 100000,
    grossCommissionCents: 40000,
    compensationDistributedCents: 20000,
    agencyNetCents: 20000,
    ...overrides,
  };
}

describe("individual payout selection", () => {
  it("includes direct Person payouts and Team-member payouts only", () => {
    expect(isRecipientCompensationPayout({ recipientType: "person" })).toBe(true);
    expect(isRecipientCompensationPayout({ recipientType: "team_member" })).toBe(true);
    expect(isRecipientCompensationPayout({ recipientType: "team" })).toBe(false);
    expect(isRecipientCompensationPayout({ recipientType: "agency" })).toBe(false);
    expect(recipientCompensationMethod("person")).toBe("direct");
    expect(recipientCompensationMethod("team_member")).toBe("team");
  });
});

describe("individual statement grouping", () => {
  it("A. includes a direct-only payout", () => {
    const rows = [individualRow({
      recipientMethod: "direct",
      teamName: null,
      allocationBps: 10000,
      compensationCents: 4659,
      payoutId: 1,
    })];
    expect(sumIndividualReport(rows).compensationCents).toBe(4659);
    expect(recipientShareLabel(rows[0]!)).toBe("100%");
  });

  it("B. includes a Team-member-only payout", () => {
    const rows = [individualRow()];
    expect(sumIndividualReport(rows).compensationCents).toBe(3261);
    expect(recipientShareLabel(rows[0]!)).toBe("70% Team");
  });

  it("C. includes both legitimate direct and Team-member payouts on different commissions", () => {
    const rows = [
      individualRow({ commissionId: 1, payoutId: 1, recipientMethod: "direct", teamName: null, allocationBps: 5000, compensationCents: 2500, groupId: 2, groupName: "Integrity" }),
      individualRow({ commissionId: 2, payoutId: 2, compensationCents: 3261 }),
    ];
    expect(sumIndividualReport(rows).compensationCents).toBe(5761);
    expect(groupIndividualReportRows(rows)).toHaveLength(2);
  });

  it("D. does not treat a Team parent as recipient compensation", () => {
    expect(isRecipientCompensationPayout({ recipientType: "team" })).toBe(false);
  });

  it("E. John-style 70/20/5/5 Team uses the canonical 70% Team-member payout", () => {
    const john = individualRow();
    expect(john.allocationBps).toBe(7000);
    expect(john.compensationCents).toBe(3261);
    expect(recipientShareLabel(john)).toBe("70% Team");
  });

  it("F. keeps chargebacks signed", () => {
    const rows = [individualRow({
      grossCommissionCents: -2519,
      compensationCents: -1763,
      commissionId: 11,
      payoutId: 111,
    })];
    expect(sumIndividualReport(rows).compensationCents).toBe(-1763);
    const document = individualReportDocument(rows, sumIndividualReport(rows), normalizeReportFilters({ kind: "individual", personId: 1 }), {}, "John Elizando");
    expect(document.rows[0]?.[4]).toBe("-$25.19");
    expect(document.rows[0]?.[6]).toBe("-$17.63");
  });

  it("G. group totals equal the transaction totals", () => {
    const rows = [
      individualRow(),
      individualRow({
        lineOfBusinessId: 2,
        lineOfBusinessName: "Vision",
        grossCommissionCents: 1398,
        compensationCents: 979,
        commissionId: 11,
        payoutId: 101,
      }),
    ];
    const [group] = groupIndividualReportRows(rows);
    expect(group?.agencyCommissionCents).toBe(4659 + 1398);
    expect(group?.recipientCompensationCents).toBe(3261 + 979);
  });

  it("H. Individual Grand Total equals canonical recipient payouts", () => {
    const rows = [
      individualRow(),
      individualRow({
        recipientMethod: "direct",
        teamName: null,
        groupId: 9,
        groupName: "Integrity",
        allocationBps: 5000,
        grossCommissionCents: 11305,
        compensationCents: 5653,
        commissionId: 84,
        payoutId: 200,
      }),
    ];
    const totals = sumIndividualReport(rows);
    expect(totals.compensationCents).toBe(3261 + 5653);
    const document = individualReportDocument(rows, totals, normalizeReportFilters({ kind: "individual", personId: 1 }), {}, "John Elizando");
    expect(document.groupSections).toHaveLength(2);
    expect(document.footerTotals?.at(-1)?.value).toBe("$89.14");
    expect(document.heading).toBe("JOHN ELIZANDO");
    expect(informalRecipientName("John Elizando")).toBe("John");
  });
});

describe("agency executive summaries", () => {
  const rows = [
    agencyRow(),
    agencyRow({ groupId: 2, groupName: "Client B", carrierId: 2, carrierName: "ChoiceBuilder", grossCommissionCents: 10000, agencyNetCents: 4000 }),
    agencyRow({ groupId: 3, groupName: "Client C", grossCommissionCents: 8000 }),
    agencyRow({ groupId: 4, groupName: "Client D", carrierId: 2, carrierName: "ChoiceBuilder", grossCommissionCents: 5000 }),
    agencyRow({ groupId: 5, groupName: "Client E", grossCommissionCents: 3000 }),
    agencyRow({ groupId: 6, groupName: "Client F", grossCommissionCents: 2000 }),
  ];

  it("I. carrier totals equal Agency Report gross", () => {
    const breakdown = agencyCarrierBreakdown(rows);
    const gross = rows.reduce((sum, row) => sum + row.grossCommissionCents, 0);
    expect(breakdown.totalCents).toBe(gross);
    expect(breakdown.rows.reduce((sum, row) => sum + row.cents, 0)).toBe(gross);
  });

  it("J. Top 5 clients rank by signed gross and combined total", () => {
    const top = agencyTopClients(rows, 5);
    expect(top.rows.map((row) => row.name)).toEqual(["Client A", "Client B", "Client C", "Client D", "Client E"]);
    expect(top.combinedCents).toBe(40000 + 10000 + 8000 + 5000 + 3000);
    expect(top.rows[0]?.cents).toBe(40000);
  });

  it("K. Top 5 percentage is combined Top 5 / selected gross", () => {
    const top = agencyTopClients(rows, 5);
    expect(top.combinedPercent).toBe("97.1%");
    expect(top.selectedGrossCents).toBe(68000);
  });

  it("L. filtered report summary, carrier breakdown, Top Clients, and detail use the same population", () => {
    const filtered = rows.filter((row) => row.carrierId === 2);
    const executive = agencyExecutiveSummary(filtered, true, null);
    expect(executive.totals.grossCommissionCents).toBe(15000);
    expect(executive.carrierBreakdown.totalCents).toBe(15000);
    expect(executive.carrierBreakdown.rows).toHaveLength(1);
    expect(executive.topClients.selectedGrossCents).toBe(15000);
    expect(executive.topClients.combinedCents).toBe(15000);
    expect(executive.topClients.combinedPercent).toBe("100.0%");
    expect(executive.cards[0]?.value).toBe("$150.00");
  });
});

describe("individual printable hierarchy", () => {
  it("renders group headers, group totals, and a named Grand Total", async () => {
    const rows = [
      individualRow(),
      individualRow({
        lineOfBusinessId: 2,
        lineOfBusinessName: "Vision",
        grossCommissionCents: 1398,
        compensationCents: 979,
        commissionId: 11,
        payoutId: 101,
      }),
    ];
    const document = individualReportDocument(
      rows,
      sumIndividualReport(rows),
      normalizeReportFilters({ kind: "individual", paidMonth: "2026-09", personId: 1 }),
      {},
      "John Elizando",
    );
    const html = printableReportHtml(document);
    expect(html).toMatch(/JOHN ELIZANDO/);
    expect(html).toMatch(/Commission Statement — September 2026/);
    expect(html).toMatch(/H &amp; R LABOR CONTRACTING INC|H & R LABOR CONTRACTING INC/);
    expect(html).toMatch(/GROUP TOTAL/);
    expect(html).toMatch(/Grand Total/);
    expect(html).toMatch(/TOTAL PAYABLE TO JOHN ELIZANDO/);
    expect(html).toMatch(/70% Team/);
    const pdf = await exportReportDocument(document, "pdf");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const parsed = await getDocumentProxy(new Uint8Array(pdf.body as Uint8Array));
    const extracted = await extractText(parsed, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join(" ") : extracted.text;
    expect(text).toMatch(/JOHN ELIZANDO/);
    expect(text).toMatch(/GROUP TOTAL/);
    expect(text).toMatch(/TOTAL PAYABLE TO JOHN ELIZANDO/);
  });
});
