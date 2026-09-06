import { describe, expect, it } from "vitest";
import { runBusyAction } from "@/lib/apiClient";
import {
  allocationConflictReviewMessage,
  allocationIntegrityRecoveryMessage,
  allocationRecoveredMessage,
  allocationSaveErrorMessage,
  allocationSavedMessage,
  allocationStillQueuedMessage,
  bulkAllocationSavedMessage,
  nextQueueItemNotice,
  runAllocationSaveFlow,
  runBulkAllocationSaveFlow,
} from "./allocationSaveFlow";

const submitted = {
  groupId: 1,
  lineOfBusinessId: 10,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: [
    { recipientType: "person" as const, personKind: "agent" as const, personId: 7, compensationBps: 10000 },
  ],
};

const exactAllocation = {
  groupId: 1,
  lineOfBusinessId: 10,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: submitted.entries,
};

const incompatibleAllocation = {
  ...exactAllocation,
  entries: [{ recipientType: "agency" as const, compensationBps: 10000 }],
};

describe("allocation save flow", () => {
  it("clears a failed save without treating it as success or changing the queue", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({ ok: false, message: "Active compensation allocation must total exactly 100 percent." }),
      refresh: async () => {
        throw new Error("refresh should not run after a failed save");
      },
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toMatch(/100 percent/);
    expect(result.success).toBeNull();
    expect(result.refreshed).toBe(false);
    expect(result.loadNext).toBe(false);
    expect(allocationSaveErrorMessage({})).toMatch(/Unable to save allocation/);
  });

  it("advances from item 1 to item 2 without keeping the previous success on the next draft", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({ ok: true }),
      refresh: async () => ({
        queue: [{ key: "2:20", groupId: 2 }, { key: "3:30", groupId: 3 }],
      }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toBeNull();
    expect(result.success).toBeNull();
    expect(result.notice).toBe(nextQueueItemNotice());
    expect(result.queue.map((item) => item.key)).toEqual(["2:20", "3:30"]);
    expect(result.queueIndex).toBe(0);
    expect(result.loadNext).toBe(true);
    expect(result.queueDone).toBe(false);
    expect(result.persistConfirmed).toBe(true);
    expect(result.stillQueued).toBe(false);
  });

  it("does not advance when the saved pair is still in the refreshed queue", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({ ok: true }),
      refresh: async () => ({
        queue: [{ key: "1:10" }, { key: "2:20" }],
      }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.success).toBe(allocationStillQueuedMessage());
    expect(result.loadNext).toBe(false);
    expect(result.stillQueued).toBe(true);
    expect(result.queueIndex).toBe(0);
    expect(result.queue.map((item) => item.key)).toEqual(["1:10", "2:20"]);
  });

  it("closes the queue after the final remaining item is saved", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({ ok: true }),
      refresh: async () => ({ queue: [] }),
      savedKey: "2:20",
      queueIndex: 0,
    });
    expect(result.success).toBe(allocationSavedMessage());
    expect(result.queueDone).toBe(true);
    expect(result.queueOpen).toBe(false);
    expect(result.loadNext).toBe(false);
  });

  it("clears Saving busy state after a successful or failed allocation save", async () => {
    const seen: boolean[] = [];
    await runBusyAction((busy) => { seen.push(busy); }, async () => {
      const result = await runAllocationSaveFlow({
        request: async () => ({ ok: true }),
        refresh: async () => ({ queue: [] }),
        savedKey: "1:10",
        queueIndex: 0,
      });
      expect(result.success).toBe(allocationSavedMessage());
      expect(result.queueDone).toBe(true);
    });
    expect(seen).toEqual([true, false]);

    seen.length = 0;
    await runBusyAction((busy) => { seen.push(busy); }, async () => {
      const result = await runAllocationSaveFlow({
        request: async () => ({ ok: false, message: "Unable to save allocation." }),
        refresh: async () => ({ queue: [] }),
        queueIndex: 0,
      });
      expect(result.error).toMatch(/Unable to save allocation/);
    });
    expect(seen).toEqual([true, false]);

    seen.length = 0;
    await expect(runBusyAction((busy) => { seen.push(busy); }, async () => {
      await runAllocationSaveFlow({
        request: async () => {
          throw new Error("The request timed out. Try again.");
        },
        refresh: async () => ({ queue: [] }),
        queueIndex: 0,
      });
    })).rejects.toThrow(/timed out/);
    expect(seen).toEqual([true, false]);
  });

  it("recovers a timeout only when the canonical allocation matches the submitted terms exactly", async () => {
    let posts = 0;
    const result = await runAllocationSaveFlow({
      request: async () => {
        posts += 1;
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "2:20" }, { key: "3:30" }],
        allocations: [exactAllocation],
      }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(posts).toBe(1);
    expect(result.error).toBeNull();
    expect(result.recovered).toBe(true);
    expect(result.loadNext).toBe(true);
    expect(result.notice).toBe(allocationRecoveredMessage());
    expect(result.queue.map((item) => item.key)).toEqual(["2:20", "3:30"]);
  });

  it("does not treat a disappeared queue item as success when the persisted allocation is incompatible", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => {
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "2:20" }],
        allocations: [incompatibleAllocation],
      }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toBe(allocationConflictReviewMessage());
    expect(result.loadNext).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.queue.map((item) => item.key)).toEqual(["2:20"]);
  });

  it("does not claim success when a timeout finds no persisted allocation", async () => {
    await expect(runAllocationSaveFlow({
      request: async () => {
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [],
        allocations: [],
      }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    })).rejects.toThrow(/timed out/);
  });

  it("recovers from an overlap error only when the persisted terms match the request", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({
        ok: false,
        message: "An active compensation allocation already exists for this group, line, and period.",
      }),
      refresh: async () => ({ queue: [{ key: "2:20" }], allocations: [exactAllocation] }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.recovered).toBe(true);
    expect(result.loadNext).toBe(true);
    expect(result.error).toBeNull();
    expect(result.queue.map((item) => item.key)).toEqual(["2:20"]);
  });

  it("keeps an incompatible overlap as a review conflict even if the queue item is gone", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({
        ok: false,
        message: "An active compensation allocation already exists for this group, line, and period.",
      }),
      refresh: async () => ({ queue: [], allocations: [incompatibleAllocation] }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toBe(allocationConflictReviewMessage());
    expect(result.loadNext).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.queueDone).toBe(false);
  });

  it("does not advance after exact recovery when the pair is still missing coverage", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => {
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "1:10" }, { key: "2:20" }],
        allocations: [exactAllocation],
      }),
      submitted,
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.recovered).toBe(true);
    expect(result.stillQueued).toBe(true);
    expect(result.loadNext).toBe(false);
    expect(result.success).toBe(allocationStillQueuedMessage());
  });
});

describe("bulk allocation save flow", () => {
  const dental = { ...submitted, lineOfBusinessId: 11 };
  const exactDental = { ...exactAllocation, lineOfBusinessId: 11 };

  it("recovers a committed bulk timeout only when every selected LOB matches exactly", async () => {
    let posts = 0;
    const result = await runBulkAllocationSaveFlow({
      request: async () => {
        posts += 1;
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [],
        allocations: [exactAllocation, exactDental],
      }),
      submitted: [submitted, dental],
    });
    expect(posts).toBe(1);
    expect(result.error).toBeNull();
    expect(result.recovered).toBe(true);
    expect(result.success).toBe(bulkAllocationSavedMessage(2));
  });

  it("reports a conflict when a timeout finds an incompatible allocation and does not retry", async () => {
    let posts = 0;
    const result = await runBulkAllocationSaveFlow({
      request: async () => {
        posts += 1;
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "1:10" }],
        allocations: [incompatibleAllocation],
      }),
      submitted: [submitted, dental],
    });
    expect(posts).toBe(1);
    expect(result.error).toBe(allocationConflictReviewMessage());
    expect(result.recovered).toBe(false);
  });

  it("reports an integrity exception when only some requested LOBs exist after a timeout", async () => {
    const result = await runBulkAllocationSaveFlow({
      request: async () => {
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "1:11" }],
        allocations: [exactAllocation],
      }),
      submitted: [submitted, dental],
    });
    expect(result.error).toBe(allocationIntegrityRecoveryMessage());
    expect(result.recovered).toBe(false);
  });
});
