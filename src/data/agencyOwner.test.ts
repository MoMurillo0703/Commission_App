import { describe, expect, it } from "vitest";
import { resolveAgencyOwnerIdentity } from "./agencyOwner";

describe("agency owner identity", () => {
  it("requires explicit numeric IDs and never uses a display name", () => {
    expect(resolveAgencyOwnerIdentity({})).toBeNull();
    expect(resolveAgencyOwnerIdentity({
      AGENCY_OWNER_PERSON_KIND: "MURILLO, MAURILIO",
      AGENCY_OWNER_PERSON_ID: "2",
    })).toBeNull();
    expect(resolveAgencyOwnerIdentity({
      AGENCY_OWNER_PERSON_KIND: "agent",
      AGENCY_OWNER_PERSON_ID: "2",
    })).toEqual({ personKind: "agent", personId: 2 });
  });
});
