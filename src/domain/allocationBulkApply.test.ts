import { describe, expect, it } from "vitest";
import { defaultLineApplyMode, plannedAllocationTargets } from "./allocationBulkApply";

describe("group-level compensation apply", () => {
  const template = [{ recipientType: "team" as const, teamId: 3, compensationBps: 10000 }];

  it("defaults missing and selected lines to the entered setup and skips already covered lines", () => {
    expect(defaultLineApplyMode(10, 10, [11], [12])).toBe("template");
    expect(defaultLineApplyMode(11, 10, [11], [12])).toBe("template");
    expect(defaultLineApplyMode(12, 10, [11], [12])).toBe("skip");
    expect(defaultLineApplyMode(13, 10, [11], [12])).toBe("skip");
  });

  it("applies the same recipients to selected lines and allows Agency 100% or skip overrides", () => {
    const targets = plannedAllocationTargets({
      lineIds: [10, 11, 12, 13],
      modes: {
        10: "template",
        11: "template",
        12: "agency",
        13: "skip",
      },
      templateEntries: template,
    });
    expect(targets).toEqual([
      { lineOfBusinessId: 10, mode: "template", entries: template },
      { lineOfBusinessId: 11, mode: "template", entries: template },
      { lineOfBusinessId: 12, mode: "agency", entries: [{ recipientType: "agency", compensationBps: 10000 }] },
    ]);
  });
});
