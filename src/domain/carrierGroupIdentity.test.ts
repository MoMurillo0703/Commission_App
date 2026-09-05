import { describe, expect, it } from "vitest";
import { matchCarrierGroupIdentity } from "./carrierGroupIdentity";

const groups = [
  { id: 9, name: "Chimay Enterprise", groupNumber: null },
  { id: 11, name: "Other Shop", groupNumber: "83746" },
];

describe("carrier-scoped group identity matching", () => {
  it("resolves the same carrier + number to the learned Group even when the company name changed", () => {
    const match = matchCarrierGroupIdentity(groups, "CHIMAY ENTERPRISE LLC", "83746", {
      carrierId: 4,
      identities: [{ carrierId: 4, externalGroupNumber: "83746", groupId: 9 }],
      requireNameConfirmation: true,
    });
    expect(match).toMatchObject({ status: "matched", groupId: 9, groupName: "Chimay Enterprise" });
  });

  it("lets a different carrier keep the same external number for a different Group", () => {
    const match = matchCarrierGroupIdentity(groups, "CHIMAY ENTERPRISE LLC", "83746", {
      carrierId: 8,
      identities: [
        { carrierId: 4, externalGroupNumber: "83746", groupId: 9 },
        { carrierId: 8, externalGroupNumber: "83746", groupId: 11 },
      ],
      requireNameConfirmation: true,
    });
    expect(match).toMatchObject({ status: "matched", groupId: 11 });
  });

  it("does not use groups.group_number and sends unknown or unique names to review", () => {
    expect(matchCarrierGroupIdentity(groups, "CHIMAY ENTERPRISE LLC", "83746", {
      carrierId: 4,
      identities: [],
      requireNameConfirmation: true,
    }).status).toBe("new_group");
    expect(matchCarrierGroupIdentity(groups, "Other Shop", "99999", {
      carrierId: 4,
      identities: [],
      requireNameConfirmation: true,
    }).status).toBe("new_group");
    expect(matchCarrierGroupIdentity([
      { id: 1, name: "Acme", groupNumber: null },
      { id: 2, name: "Acme", groupNumber: "X" },
    ], "Acme", "99999", {
      carrierId: 4,
      identities: [],
      requireNameConfirmation: true,
    }).status).toBe("ambiguous");
  });
});
