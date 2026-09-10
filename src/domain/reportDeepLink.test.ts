import { describe, expect, it } from "vitest";
import { parseReportsSearchParams, reportsHref } from "./reportDeepLink";

describe("report deep links", () => {
  it("builds typed person and agency-owner hrefs and hydrates search params", () => {
    expect(reportsHref({
      person: { personKind: "agent", personId: 2 },
      paidMonth: "2026-09",
    })).toBe("/reports?kind=individual&personKey=agent%3A2&paidMonth=2026-09");
    expect(reportsHref({ agencyOwner: true, paidMonth: "2026-09" })).toContain("personKey=agency_owner");
    expect(parseReportsSearchParams({
      personKind: "account_manager",
      personId: "9",
      paidMonth: "2026-09",
    })).toEqual({
      kind: "individual",
      personKey: "account_manager:9",
      paidMonth: "2026-09",
      groupId: "",
    });
  });
});
