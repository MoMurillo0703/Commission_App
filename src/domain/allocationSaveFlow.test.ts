import { describe, expect, it } from "vitest";
import { runBusyAction } from "@/lib/apiClient";
import {
  allocationRecoveredMessage,
  allocationSaveErrorMessage,
  allocationSavedMessage,
  allocationStillQueuedMessage,
  nextQueueItemNotice,
  runAllocationSaveFlow,
} from "./allocationSaveFlow";

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

  it("recovers when save persisted but the client sees a timeout, then advances without a second POST", async () => {
    let posts = 0;
    const result = await runAllocationSaveFlow({
      request: async () => {
        posts += 1;
        throw new Error("The request timed out. Try again.");
      },
      refresh: async () => ({
        queue: [{ key: "2:20" }, { key: "3:30" }],
      }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(posts).toBe(1);
    expect(result.error).toBeNull();
    expect(result.recovered).toBe(true);
    expect(result.loadNext).toBe(true);
    expect(result.notice).toBe(allocationRecoveredMessage());
    expect(result.queue.map((item) => item.key)).toEqual(["2:20", "3:30"]);
    expect(result.queue.some((item) => item.key === "1:10")).toBe(false);
  });

  it("recovers from an overlap error when the refreshed queue no longer includes the saved pair", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({
        ok: false,
        message: "An active compensation allocation already exists for this group, line, and period.",
      }),
      refresh: async () => ({ queue: [{ key: "2:20" }] }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.recovered).toBe(true);
    expect(result.loadNext).toBe(true);
    expect(result.error).toBeNull();
    expect(result.queue.map((item) => item.key)).toEqual(["2:20"]);
  });

  it("keeps the overlap error when the pair is still missing a covering allocation", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({
        ok: false,
        message: "An active compensation allocation already exists for this group, line, and period.",
      }),
      refresh: async () => ({ queue: [{ key: "1:10" }, { key: "2:20" }] }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toMatch(/already exists for this group, line, and period/);
    expect(result.loadNext).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.queue.map((item) => item.key)).toEqual(["1:10", "2:20"]);
  });
});
