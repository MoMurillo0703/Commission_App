import { describe, expect, it } from "vitest";
import { StatementBlockedError } from "./errors";
import { isDatabaseTimeoutError, isDatabaseUnavailableError, toErrorResponse } from "./http";

describe("database error responses", () => {
  it("maps a hung liveness check to 504", async () => {
    const response = toErrorResponse(new Error("DATABASE_LIVENESS_TIMEOUT"));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ message: "The database request timed out. Try again." });
  });

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

  it("marks a blocked statement post as unpublished", async () => {
    const response = toErrorResponse(new StatementBlockedError(
      "This statement was not posted. 1 Group needs review. No commission records were written.",
      [{ kind: "groups", message: "1 Group needs review" }],
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      posted: false,
      message: "This statement was not posted. 1 Group needs review. No commission records were written.",
      blockers: [{ kind: "groups", message: "1 Group needs review" }],
    });
  });
});
