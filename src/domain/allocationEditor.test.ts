import { describe, expect, it } from "vitest";
import { allocationEntrySchema, allocationInputSchema } from "@/lib/validation";
import {
  addDraftRecipient,
  allocationEntryPayload,
  cancelAllocationDraft,
  defaultAllocationDraft,
  emptyDraftRecipient,
  parsePersonKind,
  personRoleLabel,
  removeDraftRecipient,
} from "./allocationEditor";

describe("allocation editor recipients", () => {
  it("adds and removes Agent and Account Manager rows without matching by display name", () => {
    let entries = [emptyDraftRecipient("person", "agent")];
    entries = addDraftRecipient(entries, "person", "account_manager");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.personKind).toBe("agent");
    expect(entries[1]?.personKind).toBe("account_manager");
    expect(personRoleLabel("agent")).toBe("Agent");
    expect(personRoleLabel("account_manager")).toBe("Account manager");
    entries[0]!.personId = "1";
    entries[1]!.personId = "1";
    const payload = allocationEntryPayload(entries);
    expect(payload[0]).toMatchObject({ personKind: "agent", personId: 1 });
    expect(payload[1]).toMatchObject({ personKind: "account_manager", personId: 1 });
    expect(removeDraftRecipient(entries, 0)).toHaveLength(1);
    expect(removeDraftRecipient(entries, 0)[0]?.personKind).toBe("account_manager");
  });

  it("cancels unsaved draft state without mutating an existing allocation", () => {
    const original = defaultAllocationDraft();
    const dirty = {
      groupId: "9",
      lineOfBusinessId: "3",
      effectiveStart: "2026-09",
      effectiveEnd: "",
      entries: addDraftRecipient(original.entries, "agency"),
    };
    expect(cancelAllocationDraft()).toEqual(original);
    expect(dirty.entries).toHaveLength(2);
  });

  it("accepts empty personKind as null instead of a Zod enum error", () => {
    expect(parsePersonKind("")).toBeNull();
    expect(parsePersonKind("agent")).toBe("agent");
    const parsed = allocationEntrySchema.parse({
      recipientType: "person",
      personKind: "",
      personId: null,
      compensationPercent: "70",
    });
    expect(parsed.personKind).toBeNull();
    expect(() => allocationInputSchema.parse({
      groupId: 1,
      lineOfBusinessId: 1,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "agency", personKind: "", compensationPercent: "100" }],
    })).not.toThrow();
  });
});
