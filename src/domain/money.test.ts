import { describe, expect, it } from "vitest";
import { bpsToPercentString, centsToDollarString, parseDollarsToCents, parsePercentToBps } from "./money";

describe("currency handling", () => {
  it("parses dollar strings into integer cents without binary floating-point", () => {
    expect(parseDollarsToCents("1.15")).toBe(115);
    expect(parseDollarsToCents("$10.20")).toBe(1020);
    expect(parseDollarsToCents("2.27")).toBe(227);
    expect(parseDollarsToCents("-40.50")).toBe(-4050);
    expect(parseDollarsToCents("500")).toBe(50000);
  });

  it("round-trips integer cents back to an exact dollar string", () => {
    expect(centsToDollarString(115)).toBe("1.15");
    expect(centsToDollarString(100)).toBe("1.00");
    expect(centsToDollarString(-4050)).toBe("-40.50");
  });

  it("stores compensation percents as integer basis points", () => {
    expect(parsePercentToBps("50")).toBe(5000);
    expect(parsePercentToBps("40.25%")).toBe(4025);
    expect(bpsToPercentString(5000)).toBe("50");
    expect(bpsToPercentString(4025)).toBe("40.25");
  });

  it("rejects inexact money and out-of-range percents", () => {
    expect(() => parseDollarsToCents("1.155")).toThrow(/two decimal/);
    expect(() => parsePercentToBps("100.01")).toThrow(/cannot exceed 100/);
  });
});
