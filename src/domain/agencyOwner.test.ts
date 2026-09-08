import { describe, expect, it } from "vitest";
import { agencyOwnerForPaidMonth, ownerGapWarning, ownerIdentityFromFks, payableOwnerGapMessage } from "./agencyOwner";

describe("agency owner identity", () => {
  it("uses FKs not names and selects by paid month", () => {
    expect(ownerIdentityFromFks(2, null)).toEqual({ personKind: "agent", personId: 2 });
    expect(ownerIdentityFromFks(null, 1)).toEqual({ personKind: "account_manager", personId: 1 });
    expect(ownerIdentityFromFks(2, 1)).toBeNull();
    expect(ownerIdentityFromFks(null, null)).toBeNull();

    const owners = [
      { identity: { personKind: "agent" as const, personId: 2 }, effectiveStartMonth: "2026-01", effectiveEndMonth: "2026-06" },
      { identity: { personKind: "agent" as const, personId: 9 }, effectiveStartMonth: "2026-07", effectiveEndMonth: null },
    ];
    expect(agencyOwnerForPaidMonth(owners, "2026-06")?.personId).toBe(2);
    expect(agencyOwnerForPaidMonth(owners, "2026-07")?.personId).toBe(9);
    expect(agencyOwnerForPaidMonth(owners, "2025-12")).toBeNull();
  });
});

describe("agency owner gap warnings", () => {
  it("names the missing paid month and does not guess ownership", () => {
    expect(ownerGapWarning(["2026-09"])).toBe("Agency owner is not configured for September 2026.");
    expect(payableOwnerGapMessage(["2026-09", "2026-12"])).toMatch(/NOT PAYABLE-READY/);
    expect(payableOwnerGapMessage(["2026-09", "2026-12"])).toMatch(/September 2026/);
    expect(payableOwnerGapMessage(["2026-09", "2026-12"])).toMatch(/December 2026/);
    expect(ownerGapWarning([])).toBeNull();
  });
});
