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
    }));

    expect(html).toContain("1 group needs compensation setup");
    expect(html).toContain("1 group has Lines of Coverage that still need compensation");
    expect(html).toContain("Review groups needing allocation");
    expect(html).toContain("ABC COMPANY");
    expect(html).not.toContain("ABC COMPANY — Medical");
    expect(html).not.toContain("Save &amp; Next");
    expect((html.match(/ABC COMPANY/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
