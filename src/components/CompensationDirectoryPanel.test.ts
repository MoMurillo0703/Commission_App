import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompensationDirectoryPanel } from "./CompensationDirectoryPanel";

const stamp = "2026-09-01T00:00:00.000Z";

const row = {
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
  compensationKind: "explicit_agency" as const,
  compensationLabel: "Mo 100%",
  currentAllocationId: 8,
  currentEffectiveStart: "2026-09",
  currentEffectiveEnd: null,
  recipientKeys: ["agent:2"],
  teamIds: [],
};

describe("rendered compensation directory", () => {
  it("shows Select all matching and does not warn when owner coverage exists", () => {
    const html = renderToStaticMarkup(createElement(CompensationDirectoryPanel, {
      initialRows: [row],
      initialAsOfMonth: "2026-09",
      agents: [{ id: 2, name: "MURILLO, MAURILIO", defaultCompensationBps: null, notes: null, createdAt: stamp, updatedAt: stamp }],
      accountManagers: [],
      linesOfBusiness: [{ id: 1, name: "Group Medical", createdAt: stamp, updatedAt: stamp }],
      carriers: [],
      teams: [],
      owner: { personKind: "agent", personId: 2 },
    }));
    expect(html).toContain("Select all matching (1)");
    expect(html).toContain("Edit compensation");
    expect(html).not.toContain("Agency owner is not configured");
  });

  it("warns only when owner coverage is missing for the selected month", () => {
    const html = renderToStaticMarkup(createElement(CompensationDirectoryPanel, {
      initialRows: [{ ...row, compensationKind: "review_required", compensationLabel: "Review required", currentAllocationId: null, currentEffectiveStart: null }],
      initialAsOfMonth: "2026-08",
      agents: [],
      accountManagers: [],
      linesOfBusiness: [{ id: 1, name: "Group Medical", createdAt: stamp, updatedAt: stamp }],
      carriers: [],
      teams: [],
      owner: null,
    }));
    expect(html).toContain("Agency owner is not configured for August 2026.");
  });
});
