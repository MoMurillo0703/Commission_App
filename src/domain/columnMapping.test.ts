import { describe, expect, it } from "vitest";
import { suggestColumnMapping } from "./columnMapping";

describe("column mapping", () => {
  it("suggests commission import columns from common headers", () => {
    expect(suggestColumnMapping(["Group Name", "Carrier", "LOB", "Agent", "Premium", "Commission", "Split", "Premium Month"])).toMatchObject({
      groupName: "Group Name",
      carrier: "Carrier",
      lineOfBusiness: "LOB",
      agent: "Agent",
      premium: "Premium",
      grossCommission: "Commission",
      compensationPercent: "Split",
      premiumMonth: "Premium Month",
    });
  });
});
