import { describe, expect, it } from "vitest";
import { allocationEntrySchema, allocationInputSchema } from "@/lib/validation";
import {
  addDraftRecipient,
  allocationEntryPayload,
  cancelAllocationDraft,
  defaultAllocationDraft,
  draftFromAllocationEntries,
  emptyDraftRecipient,
  parsePersonKind,
  personRoleLabel,
  removeDraftRecipient,
} from "./allocationEditor";
import { validateAllocationEntries } from "./allocations";
import { parsePercentToBps } from "./money";
import { editAllocationHref } from "./personCompensation";

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

  it("opens the complete Group + LOB allocation for edit and still requires 100%", () => {
    const entries = draftFromAllocationEntries([
      { recipientType: "person", personKind: "agent", personId: 1, compensationPercent: "70" },
      { recipientType: "person", personKind: "agent", personId: 2, compensationPercent: "20" },
      { recipientType: "person", personKind: "account_manager", personId: 9, compensationPercent: "5" },
      { recipientType: "person", personKind: "account_manager", personId: 10, compensationPercent: "5" },
    ]);
    expect(entries).toHaveLength(4);
    expect(editAllocationHref(44)).toBe("/compensation?allocationId=44");
    const payload = allocationEntryPayload(entries).map((entry) => ({
      ...entry,
      compensationBps: parsePercentToBps(entry.compensationPercent),
    }));
    expect(() => validateAllocationEntries(payload, { requireComplete: true })).not.toThrow();
    entries[2]!.percent = "10";
    const changed = allocationEntryPayload(entries).map((entry) => ({
      ...entry,
      compensationBps: parsePercentToBps(entry.compensationPercent),
    }));
    expect(() => validateAllocationEntries(changed, { requireComplete: true })).toThrow(/100/);
  });
});
