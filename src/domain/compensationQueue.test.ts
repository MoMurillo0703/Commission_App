import { describe, expect, it } from "vitest";
import {
  afterSaveQueue,
  closeQueue,
  identifyCompensationQueue,
  queueBannerLabel,
  skipQueueIndex,
} from "./compensationQueue";

const groups = [
  { id: 1, name: "H R LABOR CONTRACTING" },
  { id: 2, name: "Second Group" },
];
const lines = [{ id: 10, name: "Group Medical" }];

describe("compensation work queue", () => {
  it("identifies missing, incomplete, and inactive allocations and does not invent replacements", () => {
    const items = identifyCompensationQueue({
      groups,
      linesOfBusiness: lines,
      allocations: [{
        id: 5,
        groupId: 1,
        lineOfBusinessId: 10,
        effectiveStart: "2026-01",
        effectiveEnd: null,
        status: "inactive",
        entries: [{ recipientType: "person", personKind: "agent", personId: 1, compensationBps: 4000 }],
      }],
      posted: [{ groupId: 1, lineOfBusinessId: 10, paidMonth: "2026-08" }],
      asOfMonth: "2026-09",
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.reason).toBe("incomplete");
    expect(items[0]?.groupName).toBe("H R LABOR CONTRACTING");
    expect(queueBannerLabel(items)).toBe("1 group needs compensation setup");
  });

  it("keeps an incomplete legacy allocation in the queue and skips groups that already have 100%", () => {
    const complete = identifyCompensationQueue({
      groups,
      linesOfBusiness: lines,
      allocations: [{
        id: 8,
        groupId: 1,
        lineOfBusinessId: 10,
        effectiveStart: "2026-01",
        effectiveEnd: null,
        status: "active",
        entries: [
          { recipientType: "person", personKind: "agent", personId: 1, compensationBps: 7000 },
          { recipientType: "agency", compensationBps: 3000 },
        ],
      }],
      posted: [{ groupId: 1, lineOfBusinessId: 10, paidMonth: "2026-08" }],
      asOfMonth: "2026-09",
    });
    expect(complete).toHaveLength(0);

    const missing = identifyCompensationQueue({
      groups: [groups[1]!],
      linesOfBusiness: lines,
      allocations: [],
      posted: [{ groupId: 2, lineOfBusinessId: 10, paidMonth: "2026-08" }],
      asOfMonth: "2026-09",
    });
    expect(missing[0]?.reason).toBe("missing");
  });

  it("supports Save & Next, Skip, and Close without fabricating allocations", () => {
    const items = [
      { key: "1:10", groupId: 1 },
      { key: "2:10", groupId: 2 },
    ];
    expect(skipQueueIndex(0, items.length)).toEqual({ index: 1, done: false });
    expect(skipQueueIndex(1, items.length)).toEqual({ index: 1, done: true });
    expect(afterSaveQueue(items, 0, "1:10")).toEqual({ items: [items[1]], index: 0, done: false });
    expect(afterSaveQueue([items[1]!], 0, "2:10")).toEqual({ items: [], index: 0, done: true });
    expect(closeQueue()).toEqual({ open: false });
  });
});
