import { describe, expect, it } from "vitest";
import { runBusyAction } from "@/lib/apiClient";
import { allocationSaveErrorMessage, allocationSavedMessage, runAllocationSaveFlow } from "./allocationSaveFlow";

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
    expect(allocationSaveErrorMessage({})).toMatch(/Unable to save allocation/);
  });

  it("records success and updates the work queue after a persisted save", async () => {
    const result = await runAllocationSaveFlow({
      request: async () => ({ ok: true }),
      refresh: async () => ({
        queue: [{ key: "2:20" }],
      }),
      savedKey: "1:10",
      queueIndex: 0,
    });
    expect(result.error).toBeNull();
    expect(result.success).toBe(allocationSavedMessage());
    expect(result.refreshed).toBe(true);
    expect(result.queue.map((item) => item.key)).toEqual(["2:20"]);
    expect(result.queueDone).toBe(false);
    expect(result.queueOpen).toBe(true);
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
});
