import { describe, expect, it } from "vitest";
import { runBusyAction } from "@/lib/apiClient";
import {
  runTeamSaveFlow,
  teamAvailableForAllocation,
  teamSavedMessage,
  teamSaveErrorMessage,
} from "./teamSaveFlow";

describe("team save flow", () => {
  it("clears Saving busy state after a successful or failed team save", async () => {
    const seen: boolean[] = [];
    await runBusyAction((busy) => { seen.push(busy); }, async () => {
      const result = await runTeamSaveFlow({
        request: async () => ({ ok: true }),
        refresh: async () => ({
          teams: [{ name: "Central Valley", status: "active" }],
        }),
        savedName: "Central Valley",
      });
      expect(result.success).toBe(teamSavedMessage());
      expect(result.available).toBe(true);
    });
    expect(seen).toEqual([true, false]);

    seen.length = 0;
    await runBusyAction((busy) => { seen.push(busy); }, async () => {
      const result = await runTeamSaveFlow({
        request: async () => ({ ok: false, message: "Team member splits must total 100 percent." }),
        refresh: async () => {
          throw new Error("refresh should not run after a failed save");
        },
        savedName: "Central Valley",
      });
      expect(result.error).toMatch(/100 percent/);
      expect(result.available).toBe(false);
      expect(result.refreshed).toBe(false);
    });
    expect(seen).toEqual([true, false]);
    expect(teamSaveErrorMessage({})).toMatch(/Unable to save team/);
  });

  it("clears Saving busy state after a team-save timeout", async () => {
    const seen: boolean[] = [];
    await expect(runBusyAction((busy) => { seen.push(busy); }, async () => {
      await runTeamSaveFlow({
        request: async () => {
          throw new Error("The request timed out. Try again.");
        },
        refresh: async () => ({ teams: [] }),
        savedName: "Central Valley",
      });
    })).rejects.toThrow(/timed out/);
    expect(seen).toEqual([true, false]);
  });

  it("treats the saved Team as available to the compensation workflow", () => {
    expect(teamAvailableForAllocation(
      [{ name: "Central Valley", status: "active" }],
      "Central Valley",
    )).toBe(true);
    expect(teamAvailableForAllocation(
      [{ name: "Central Valley", status: "inactive" }],
      "Central Valley",
    )).toBe(false);
    expect(teamAvailableForAllocation([], "Central Valley")).toBe(false);
  });
});
