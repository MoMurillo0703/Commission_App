import { describe, expect, it } from "vitest";
import {
  canSaveExplicitSplit,
  classifyGroupLobCompensation,
  compensationChangeConflictMessage,
  rollupGroupCompensationStatus,
  splitEditProgressLabel,
  suggestedCompensationChangeStart,
} from "./groupCompensationStatus";

const johnSplit = {
  id: 11,
  status: "active" as const,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  entries: [
    { recipientType: "person", personName: "John Elizondo", compensationBps: 7000 },
    { recipientType: "person", personName: "Maurilio Murillo", compensationBps: 2000 },
    { recipientType: "person", personName: "Laura Montoya", compensationBps: 500 },
    { recipientType: "person", personName: "Nancy Murillo", compensationBps: 500 },
  ],
};

describe("group compensation status", () => {
  it("treats an explicit valid 100% split as configured, not needing setup", () => {
    const view = classifyGroupLobCompensation({ asOfMonth: "2026-09", allocations: [johnSplit] });
    expect(view.kind).toBe("explicit_configured");
    expect(view.configured).toBe(true);
    expect(view.invalid).toBe(false);
    expect(view.setupOpportunity).toBe(false);
    expect(view.label).not.toMatch(/needs setup/i);
    expect(view.recipientSummary).toMatch(/John Elizondo 70%/);
  });

  it("treats explicit Agency 100% as configured and fallback Agency 100% as default", () => {
    const configured = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [{
        id: 1,
        status: "active",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
    });
    expect(configured.kind).toBe("explicit_agency");
    expect(configured.label).toMatch(/Configured/);
    expect(configured.invalid).toBe(false);

    const fallback = classifyGroupLobCompensation({ asOfMonth: "2026-09", allocations: [] });
    expect(fallback.kind).toBe("default_unconfigured");
    expect(fallback.label).toMatch(/Default/);
    expect(fallback.invalid).toBe(false);
    expect(fallback.setupOpportunity).toBe(true);
  });

  it("does not treat future or ended allocations as current", () => {
    const future = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [{
        id: 2,
        status: "active",
        effectiveStart: "2026-11",
        effectiveEnd: null,
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
    });
    expect(future.kind).toBe("future");
    expect(future.configured).toBe(false);

    const ended = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [{
        id: 3,
        status: "active",
        effectiveStart: "2026-01",
        effectiveEnd: "2026-08",
        entries: johnSplit.entries,
      }],
    });
    expect(ended.kind).toBe("historical");
    expect(ended.configured).toBe(false);
    expect(ended.historical).toHaveLength(1);
  });

  it("marks incomplete current allocations as review required", () => {
    const view = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [{
        id: 4,
        status: "active",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        entries: [{ recipientType: "person", personName: "John", compensationBps: 7000 }],
      }],
    });
    expect(view.kind).toBe("review_required");
    expect(view.invalid).toBe(true);
  });

  it("marks multiple complete current covering allocations as review required", () => {
    const view = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [
        { ...johnSplit, id: 14, effectiveStart: "2026-01" },
        { ...johnSplit, id: 15, effectiveStart: "2026-06" },
      ],
    });
    expect(view.kind).toBe("review_required");
    expect(view.statusLabel).toMatch(/more than one/i);
  });

  it("does not treat an inactive covering allocation as current configuration", () => {
    const view = classifyGroupLobCompensation({
      asOfMonth: "2026-09",
      allocations: [{
        id: 6,
        status: "inactive",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
    });
    expect(view.kind).toBe("inactive");
    expect(view.configured).toBe(false);
    expect(view.invalid).toBe(false);
  });

  it("explains an overlap instead of treating a valid current 100% as a failed save", () => {
    const message = compensationChangeConflictMessage({
      requestedStart: "2026-08",
      requestedEnd: null,
      siblings: [{
        id: 9,
        groupId: 1,
        lineOfBusinessId: 10,
        effectiveStart: "2026-09",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
      requested: {
        groupId: 1,
        lineOfBusinessId: 10,
        effectiveStart: "2026-08",
        entries: [{ recipientType: "person", personKind: "agent", personId: 1, compensationBps: 10000 }],
      },
    });
    expect(message).toMatch(/already starts in Sep 2026/i);
    expect(message).not.toMatch(/already exists for this group, line, and period/i);
    expect(suggestedCompensationChangeStart("2026-09", "2026-09")).toBe("2026-10");
    expect(suggestedCompensationChangeStart("2026-09", "2026-01")).toBe("2026-09");
  });

  it("only allows save at exactly 100%", () => {
    expect(canSaveExplicitSplit(7000)).toBe(false);
    expect(canSaveExplicitSplit(10001)).toBe(false);
    expect(canSaveExplicitSplit(10000)).toBe(true);
    expect(splitEditProgressLabel(7000)).toBe("Allocated: 70% · Remaining: 30%");
    expect(splitEditProgressLabel(10000)).toBe("Allocated: 100% · Ready to Save");
    expect(rollupGroupCompensationStatus([{ kind: "explicit_agency" }, { kind: "explicit_configured" }]).label).toBe("Configured");
  });
});
