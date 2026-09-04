import { describe, expect, it } from "vitest";
import { isDatabaseTimeoutError, isDatabaseUnavailableError, toErrorResponse } from "./http";

describe("database error responses", () => {
  it("maps statement and connect timeouts to 504", async () => {
    const timeout = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    expect(isDatabaseTimeoutError(timeout)).toBe(true);
    const response = toErrorResponse(timeout);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ message: "The database request timed out. Try again." });
  });

  it("maps connection failures to 503", async () => {
    const missing = new Error("getaddrinfo ENOTFOUND aws-0-us-east-1.pooler.supabase.com");
    expect(isDatabaseUnavailableError(missing)).toBe(true);
    const response = toErrorResponse(missing);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ message: "The database is temporarily unavailable. Try again." });
  });
});
