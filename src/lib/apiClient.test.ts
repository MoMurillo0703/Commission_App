import { describe, expect, it, vi } from "vitest";
import { httpFailureMessage, readApiJson, runBusyAction } from "./apiClient";

describe("API client failure handling", () => {
  it("prefers a server message and maps timeout and unavailable statuses", () => {
    expect(httpFailureMessage(504, "The database request timed out. Try again.")).toBe("The database request timed out. Try again.");
    expect(httpFailureMessage(504)).toBe("The database request timed out. Try again.");
    expect(httpFailureMessage(503)).toBe("The database is temporarily unavailable. Try again.");
    expect(httpFailureMessage(500)).toBe("The server could not finish this request. Try again.");
  });

  it("reads JSON and fails clearly on HTML timeout pages", async () => {
    const ok = new Response(JSON.stringify({ message: "ready" }), { status: 200 });
    await expect(readApiJson<{ message: string }>(ok)).resolves.toEqual({ message: "ready" });

    const html = new Response("<html>FUNCTION_INVOCATION_TIMEOUT</html>", { status: 504 });
    await expect(readApiJson(html)).rejects.toThrow(/timed out/i);
  });

  it("always clears busy after a thrown upload or preview action", async () => {
    const seen: boolean[] = [];
    await expect(runBusyAction((busy) => { seen.push(busy); }, async () => {
      throw new Error("network");
    })).rejects.toThrow(/network/);
    expect(seen).toEqual([true, false]);

    seen.length = 0;
    await runBusyAction((busy) => { seen.push(busy); }, async () => undefined);
    expect(seen).toEqual([true, false]);
  });
});
