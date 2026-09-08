import { describe, expect, it } from "vitest";
import { agencyOwnerForPaidMonth, ownerIdentityFromFks } from "./agencyOwner";

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
