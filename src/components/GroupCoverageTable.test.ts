import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GroupCoverageTable } from "./GroupCoverageTable";
import { defaultCoverageModes, groupCoverageLines } from "@/domain/groupCoverage";

const lines = [
  { id: 1, name: "Medical" },
  { id: 2, name: "Dental" },
  { id: 3, name: "Vision" },
  { id: 4, name: "Life" },
];

describe("rendered group coverage table", () => {
  it("renders every Group LOB with status, default selection, and bulk controls", () => {
    const coverage = groupCoverageLines({
      groupId: 1,
      lines,
      evidence: lines.map((line) => ({ groupId: 1, lineOfBusinessId: line.id })),
      allocations: [{
        id: 40,
        groupId: 1,
        groupName: "ABC COMPANY",
        lineOfBusinessId: 4,
        lineOfBusinessName: "Life",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", personName: null, teamName: null, compensationBps: 10000 }],
      }],
    });
    const html = renderToStaticMarkup(createElement(GroupCoverageTable, {
      lines: coverage,
      modes: defaultCoverageModes(coverage),
      templateEntries: [],
      onToggle() {},
      onAgency() {},
      onChange() {},
      onDeactivate() {},
      onSelectNeedingSetup() {},
      onClearSelection() {},
    }));

    expect(html).toContain("Select All Needing Setup");
    expect(html).toContain("Clear Selection");
    expect(html).toContain("Medical");
    expect(html).toContain("Dental");
    expect(html).toContain("Vision");
    expect(html).toContain("Life");
    expect(html).toContain("Needs setup");
    expect(html).toContain("Agency 100%");
    expect(html).toContain("Agency 100%");
    expect(html.match(/Needs setup/g)?.length).toBe(3);
    expect(html).toContain("Change");
    expect(html).toContain('aria-label="Select Medical"');
    expect(html).toContain('aria-label="Select Life"');
    expect(html).toMatch(/aria-label="Select Medical"[^>]*checked/);
    expect(html).not.toMatch(/aria-label="Select Life"[^>]*checked/);
  });
});
