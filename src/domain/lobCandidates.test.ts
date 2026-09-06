import { describe, expect, it } from "vitest";
import { isImpossibleLobCandidate } from "./lobCandidates";

describe("impossible LOB candidates", () => {
  it("rejects currency, money, carrier months, rates, blanks, and structural labels", () => {
    expect(isImpossibleLobCandidate("$")).toBe(true);
    expect(isImpossibleLobCandidate("1,724.85")).toBe(true);
    expect(isImpossibleLobCandidate("05-26")).toBe(true);
    expect(isImpossibleLobCandidate("08-26")).toBe(true);
    expect(isImpossibleLobCandidate("09-26")).toBe(true);
    expect(isImpossibleLobCandidate("5.0")).toBe(true);
    expect(isImpossibleLobCandidate("6.5%")).toBe(true);
    expect(isImpossibleLobCandidate("")).toBe(true);
    expect(isImpossibleLobCandidate("PRODUCT")).toBe(true);
    expect(isImpossibleLobCandidate("PAID MONTH")).toBe(true);
    expect(isImpossibleLobCandidate("86216")).toBe(true);
  });

  it("keeps legitimate carrier products", () => {
    expect(isImpossibleLobCandidate("Medical")).toBe(false);
    expect(isImpossibleLobCandidate("Chiro")).toBe(false);
    expect(isImpossibleLobCandidate("Acupuncture")).toBe(false);
    expect(isImpossibleLobCandidate("PPO Dental")).toBe(false);
  });
});
