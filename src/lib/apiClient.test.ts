import { describe, expect, it, vi } from "vitest";
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  CLIENT_TIMEOUT_MESSAGE,
  fetchWithDeadline,
  httpFailureMessage,
  readApiJson,
  RequestTimeoutError,
  requestFailureMessage,
  runBusyAction,
} from "./apiClient";

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

  it("aborts a fetch that never settles, clears busy, and does not retry", async () => {
    expect(CLIENT_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
    let fetchCalls = 0;
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    });
    const seen: boolean[] = [];
    await expect(runBusyAction((busy) => { seen.push(busy); }, async () => {
      await fetchWithDeadline("/api/imports/inspect", { method: "POST" }, 25);
    })).rejects.toSatisfy((error) => error instanceof RequestTimeoutError && error.message === CLIENT_TIMEOUT_MESSAGE);
    expect(requestFailureMessage(new RequestTimeoutError(), "Unable to preview rows.")).toBe(CLIENT_TIMEOUT_MESSAGE);
    expect(seen).toEqual([true, false]);
    expect(fetchCalls).toBe(1);
    vi.unstubAllGlobals();
  });
});
