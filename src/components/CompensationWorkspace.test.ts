import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompensationWorkspace } from "./CompensationWorkspace";

const stamp = "2026-09-01T00:00:00.000Z";

describe("rendered Compensation workspace", () => {
  it("lists the Group once in Missing Compensation instead of four LOB queue items", () => {
    const html = renderToStaticMarkup(createElement(CompensationWorkspace, {
      groups: [{
        id: 1,
        name: "ABC COMPANY",
        groupNumber: null,
        notes: null,
        accountManagerId: null,
        primaryAgentId: null,
        defaultCompensationBps: null,
        createdAt: stamp,
        updatedAt: stamp,
      }],
      agents: [],
      accountManagers: [],
      linesOfBusiness: [
        { id: 1, name: "Medical", createdAt: stamp, updatedAt: stamp },
        { id: 2, name: "Dental", createdAt: stamp, updatedAt: stamp },
        { id: 3, name: "Vision", createdAt: stamp, updatedAt: stamp },
        { id: 4, name: "Life", createdAt: stamp, updatedAt: stamp },
      ],
      initialAllocations: [{
        id: 40,
        groupId: 1,
        groupName: "ABC COMPANY",
        lineOfBusinessId: 4,
        lineOfBusinessName: "Life",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        status: "active",
        sourceAgreementId: null,
        createdAt: stamp,
        updatedAt: stamp,
        entries: [{
          id: 1,
          recipientType: "agency",
          personKind: null,
          personId: null,
          personName: null,
          teamId: null,
          teamName: null,
          compensationBps: 10000,
          sortOrder: 0,
        }],
      }],
      initialTeams: [],
      initialQueue: [{
        key: "group:1",
        groupId: 1,
        groupName: "ABC COMPANY",
        needingLineCount: 3,
        lineOfBusinessIds: [1, 2, 3],
        lineOfBusinessNames: ["Medical", "Dental", "Vision"],
        reason: "missing",
        reasonLabel: "Missing compensation allocation",
        suggestedEffectiveStart: "2026-08",
        lines: [],
      }],
      groupLineEvidence: [
        { groupId: 1, lineOfBusinessId: 1 },
        { groupId: 1, lineOfBusinessId: 2 },
        { groupId: 1, lineOfBusinessId: 3 },
        { groupId: 1, lineOfBusinessId: 4 },
      ],
      compensationDirectory: [{
        key: "1:medical",
        groupId: 1,
        groupName: "ABC COMPANY",
        groupNumber: null,
        primaryAgentId: null,
        primaryAgentName: null,
        accountManagerId: null,
        accountManagerName: null,
        carrierIds: [],
        carrierNames: [],
        lineOfBusinessId: 1,
        lineOfBusinessName: "Group Medical",
        canonicalKey: "1:medical",
        compensationKind: "default_unconfigured",
        compensationLabel: "Mo 100% — Default",
        currentAllocationId: null,
        currentEffectiveStart: null,
        currentEffectiveEnd: null,
        recipientKeys: ["agent:2"],
        teamIds: [],
      }],
    }));

    expect(html).toContain("Compensation directory");
    expect(html).toContain("1 group needs compensation attention");
    expect(html).toContain("Search a Group below");
    expect(html).toContain("Show default Mo 100% targets");
    expect(html).toContain("Select all matching");
    expect(html).toContain("Edit compensation");
    expect(html).not.toContain("Browse by group");
    expect(html).not.toContain("Review groups needing allocation");
    expect(html).not.toContain("Compensation reconciliation");
    expect(html).not.toContain("Team parents are ignored");
    expect(html).not.toContain("Save &amp; Next");
    expect((html.match(/ABC COMPANY/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
