import { describe, expect, it } from "vitest";
import { safeLocalRedirect } from "./redirect";

describe("safeLocalRedirect", () => {
  it("allows an application-relative path", () => {
    expect(safeLocalRedirect("/statements?month=2026-08")).toBe("/statements?month=2026-08");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeLocalRedirect("https://example.com")).toBe("/");
    expect(safeLocalRedirect("//example.com")).toBe("/");
  });
});
