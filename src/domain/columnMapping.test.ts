import { describe, expect, it } from "vitest";
import { mappingFieldLabels, mappingFields, normalizeColumnMapping, suggestColumnMapping } from "./columnMapping";

describe("column mapping", () => {
  it("suggests commission import columns from common headers without Agent split %", () => {
    const mapping = suggestColumnMapping(["Group Name", "Carrier", "LOB", "Agent", "Premium", "Commission", "Split", "Premium Month"]);
    expect(mapping).toMatchObject({
      groupName: "Group Name",
      carrier: "Carrier",
      lineOfBusiness: "LOB",
      agent: "Agent",
      premium: "Premium",
      grossCommission: "Commission",
      premiumMonth: "Premium Month",
    });
    expect(mapping.compensationPercent).toBeUndefined();
    expect(mappingFields).not.toContain("compensationPercent");
    expect(Object.values(mappingFieldLabels)).not.toContain("Agent split %");
  });

  it("clears a leftover Agent split mapping so it cannot override compensation", () => {
    expect(normalizeColumnMapping({
      groupName: "Group Name",
      compensationPercent: "Split",
    })).toEqual({
      groupName: "Group Name",
    });
  });
});
