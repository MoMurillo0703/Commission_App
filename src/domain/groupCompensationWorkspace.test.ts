import { describe, expect, it } from "vitest";
import { plannedAllocationTargets } from "./allocationBulkApply";
import { identifyCompensationQueue } from "./compensationQueue";
import { draftFromAllocationEntries } from "./allocationEditor";
import { setCoverageMode } from "./groupCoverage";
import {
  afterGroupWorkspaceApply,
  buildGroupCompensationWorkspace,
  bulkAllocationRequestBody,
} from "./groupCompensationWorkspace";

const lines = [
  { id: 1, name: "Medical" },
  { id: 2, name: "Dental" },
  { id: 3, name: "Vision" },
  { id: 4, name: "Life" },
];

const templateEntries = [
  { recipientType: "person" as const, personKind: "agent" as const, personId: 7, compensationBps: 7000 },
  { recipientType: "person" as const, personKind: "agent" as const, personId: 8, compensationBps: 2000 },
  { recipientType: "person" as const, personKind: "account_manager" as const, personId: 9, compensationBps: 1000 },
];

const lifeAllocation = {
  id: 40,
  groupId: 1,
  groupName: "ABC COMPANY",
  lineOfBusinessId: 4,
  lineOfBusinessName: "Life",
  effectiveStart: "2026-01",
  effectiveEnd: null,
  status: "active" as const,
  entries: [{ recipientType: "agency" as const, personName: null, teamName: null, compensationBps: 10000 }],
};

function acceptancePairs() {
  return identifyCompensationQueue({
    groups: [{ id: 1, name: "ABC COMPANY" }, { id: 2, name: "NEXT GROUP" }],
    linesOfBusiness: lines,
    allocations: [{
      id: 40,
      groupId: 1,
      lineOfBusinessId: 4,
      effectiveStart: "2026-01",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }],
    posted: [
      { groupId: 1, lineOfBusinessId: 1, paidMonth: "2026-08" },
      { groupId: 1, lineOfBusinessId: 2, paidMonth: "2026-08" },
      { groupId: 1, lineOfBusinessId: 3, paidMonth: "2026-08" },
      { groupId: 1, lineOfBusinessId: 4, paidMonth: "2026-08" },
      { groupId: 2, lineOfBusinessId: 1, paidMonth: "2026-08" },
    ],
    asOfMonth: "2026-09",
  });
}

describe("group-first compensation workspace", () => {
  it("shows one Group queue item, all four LOBs, and applies one split only to unconfigured lines", () => {
    const workspace = buildGroupCompensationWorkspace({
      pairs: acceptancePairs(),
      groupId: 1,
      lines,
      evidence: lines.map((line) => ({ groupId: 1, lineOfBusinessId: line.id })),
      allocations: [lifeAllocation],
      templateEntries,
      asOfMonth: "2026-09",
    });

    expect(workspace.queue).toHaveLength(2);
    expect(workspace.queue.filter((item) => item.groupId === 1)).toHaveLength(1);
    expect(workspace.queueItem?.groupName).toBe("ABC COMPANY");
    expect(workspace.queueNeedsLabel).toBe("3 Lines of Coverage need compensation");
    expect(workspace.rows.map((row) => row.name)).toEqual(["Medical", "Dental", "Vision", "Life"]);
    expect(workspace.rows.find((row) => row.name === "Life")).toMatchObject({
      status: "Agency 100% — Configured",
      selectedByDefault: false,
      configured: true,
    });
    expect(workspace.rows.filter((row) => row.selectedByDefault).map((row) => row.name)).toEqual([
      "Medical",
      "Dental",
      "Vision",
    ]);
    expect(workspace.applyTargets.map((target) => target.lineOfBusinessId)).toEqual([1, 2, 3]);
    expect(workspace.applyTargets.every((target) => target.entries === templateEntries || JSON.stringify(target.entries) === JSON.stringify(templateEntries))).toBe(true);

    const body = bulkAllocationRequestBody({
      groupId: 1,
      effectiveStart: "2026-09",
      effectiveEnd: "",
      targets: workspace.applyTargets,
      draftEntries: draftFromAllocationEntries([
        { recipientType: "person", personKind: "agent", personId: 7, compensationPercent: "70" },
        { recipientType: "person", personKind: "agent", personId: 8, compensationPercent: "20" },
        { recipientType: "person", personKind: "account_manager", personId: 9, compensationPercent: "10" },
      ]),
    });
    expect(body.targets).toHaveLength(3);
    expect(body.targets.map((target) => target.lineOfBusinessId)).toEqual([1, 2, 3]);
    expect(body.targets.some((target) => target.lineOfBusinessId === 4)).toBe(false);

    const afterApply = afterGroupWorkspaceApply(
      workspace.queue.filter((item) => item.groupId !== 1),
      1,
      0,
    );
    expect(afterApply.advance).toBe(true);
    expect(afterApply.done).toBe(false);
    expect(afterApply.items[0]?.groupId).toBe(2);
  });

  it("lets Mo override one configured LOB without selecting the others", () => {
    const workspace = buildGroupCompensationWorkspace({
      pairs: acceptancePairs(),
      groupId: 1,
      lines,
      evidence: lines.map((line) => ({ groupId: 1, lineOfBusinessId: line.id })),
      allocations: [lifeAllocation],
      templateEntries,
      asOfMonth: "2026-09",
    });
    const overrideModes = setCoverageMode(
      Object.fromEntries(workspace.coverage.map((line) => [line.lineOfBusinessId, "skip"])),
      4,
      "template",
    );
    const targets = plannedAllocationTargets({
      lineIds: workspace.coverage.map((line) => line.lineOfBusinessId),
      modes: overrideModes,
      templateEntries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    expect(targets).toEqual([{
      lineOfBusinessId: 4,
      mode: "template",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }]);
  });

  it("keeps the Group in the queue when any applicable LOB still needs compensation", () => {
    const remaining = [{ groupId: 1, key: "group:1" }, { groupId: 2, key: "group:2" }];
    expect(afterGroupWorkspaceApply(remaining, 1, 0)).toEqual({
      items: remaining,
      index: 0,
      done: false,
      advance: false,
    });
    expect(afterGroupWorkspaceApply([], 1, 0)).toEqual({
      items: [],
      index: 0,
      done: true,
      advance: true,
    });
  });

  it("persists selected unconfigured LOBs as explicit Agency 100% when no template is entered", () => {
    const workspace = buildGroupCompensationWorkspace({
      pairs: acceptancePairs(),
      groupId: 1,
      lines,
      evidence: lines.map((line) => ({ groupId: 1, lineOfBusinessId: line.id })),
      allocations: [lifeAllocation],
      asOfMonth: "2026-08",
    });
    expect(workspace.applyTargets.every((target) => target.mode === "agency")).toBe(true);
    expect(workspace.applyTargets.map((target) => target.lineOfBusinessId)).toEqual([1, 2, 3]);
    const body = bulkAllocationRequestBody({
      groupId: 1,
      effectiveStart: "2026-08",
      effectiveEnd: "",
      targets: workspace.applyTargets,
      draftEntries: draftFromAllocationEntries([{ recipientType: "agency", compensationPercent: "100" }]),
    });
    expect(body.targets.every((target) => target.entries[0]?.recipientType === "agency")).toBe(true);
    expect(body.targets.some((target) => target.lineOfBusinessId === 4)).toBe(false);
  });
});
