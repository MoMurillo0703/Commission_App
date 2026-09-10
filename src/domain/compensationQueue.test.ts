import { describe, expect, it } from "vitest";
import {
  afterGroupQueueRefresh,
  afterSaveQueue,
  closeQueue,
  groupCompensationQueue,
  groupQueueNeedsLabel,
  identifyCompensationQueue,
  queueBannerLabel,
  queueSessionProgressLabel,
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
    expect(queueBannerLabel(items)).toBe("1 group needs compensation attention");
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
    expect(missing[0]?.reasonLabel).toMatch(/not explicitly configured/i);
  });

  it("does not treat a current 100% allocation as needing setup because older posted months used Agency default", () => {
    const items = identifyCompensationQueue({
      groups,
      linesOfBusiness: lines,
      allocations: [{
        id: 9,
        groupId: 1,
        lineOfBusinessId: 10,
        effectiveStart: "2026-09",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
      posted: [
        { groupId: 1, lineOfBusinessId: 10, paidMonth: "2026-08" },
        { groupId: 1, lineOfBusinessId: 10, paidMonth: "2026-09" },
      ],
      asOfMonth: "2026-09",
    });
    expect(items).toHaveLength(0);
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
    expect(queueSessionProgressLabel(0, 44)).toBe("1 of 44");
    expect(queueSessionProgressLabel(1, 44)).toBe("2 of 44");
    expect(closeQueue()).toEqual({ open: false });
  });

  it("groups repetitive Group + LOB queue pairs into one Group work item", () => {
    const pairs = identifyCompensationQueue({
      groups: [{ id: 1, name: "ABC COMPANY" }],
      linesOfBusiness: [
        { id: 1, name: "Medical" },
        { id: 2, name: "Dental" },
        { id: 3, name: "Vision" },
        { id: 4, name: "Life" },
      ],
      allocations: [{
        id: 9,
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
      ],
      asOfMonth: "2026-09",
    });
    expect(pairs).toHaveLength(3);
    const grouped = groupCompensationQueue(pairs);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      key: "group:1",
      groupName: "ABC COMPANY",
      needingLineCount: 3,
    });
    expect(groupQueueNeedsLabel(grouped[0]!.needingLineCount)).toBe("3 Lines of Coverage need compensation");
    expect(queueBannerLabel(grouped)).toBe("1 group needs compensation attention");
    expect(afterGroupQueueRefresh(grouped, 1, 0).advance).toBe(false);
    expect(afterGroupQueueRefresh([], 1, 0)).toEqual({ items: [], index: 0, done: true, advance: true });
  });
});
