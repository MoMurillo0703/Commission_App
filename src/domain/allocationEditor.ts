import type { PersonKind, RecipientType } from "./allocations";

export type DraftRecipient = {
  recipientType: RecipientType;
  personKind: PersonKind | "";
  personId: string;
  teamId: string;
  percent: string;
};

export function emptyDraftRecipient(
  recipientType: RecipientType = "person",
  personKind: PersonKind | "" = recipientType === "person" ? "agent" : "",
): DraftRecipient {
  return {
    recipientType,
    personKind,
    personId: "",
    teamId: "",
    percent: "",
  };
}

export function defaultAllocationDraft() {
  return {
    groupId: "",
    lineOfBusinessId: "",
    effectiveStart: "",
    effectiveEnd: "",
    entries: [emptyDraftRecipient("person", "agent")],
  };
}

export function cancelAllocationDraft() {
  return defaultAllocationDraft();
}

export function addDraftRecipient(
  entries: DraftRecipient[],
  recipientType: RecipientType,
  personKind: PersonKind | "" = recipientType === "person" ? "agent" : "",
) {
  return [...entries, emptyDraftRecipient(recipientType, personKind)];
}

export function removeDraftRecipient(entries: DraftRecipient[], index: number) {
  return entries.filter((_, itemIndex) => itemIndex !== index);
}

export function personRoleLabel(kind: PersonKind | "" | null | undefined) {
  if (kind === "account_manager") return "Account manager";
  if (kind === "agent") return "Agent";
  return "Person";
}

export function parsePersonKind(value: string | null | undefined): PersonKind | null {
  if (value === "agent" || value === "account_manager") return value;
  return null;
}

export function draftFromAllocationEntries(entries: Array<{
  recipientType: RecipientType;
  personKind?: PersonKind | null;
  personId?: number | null;
  teamId?: number | null;
  compensationPercent: string;
}>): DraftRecipient[] {
  if (entries.length === 0) return [emptyDraftRecipient("person", "agent")];
  return entries.map((entry) => ({
    recipientType: entry.recipientType,
    personKind: entry.recipientType === "person" ? (entry.personKind ?? "agent") : "",
    personId: entry.personId == null ? "" : String(entry.personId),
    teamId: entry.teamId == null ? "" : String(entry.teamId),
    percent: entry.compensationPercent,
  }));
}

export function allocationEntryPayload(entries: DraftRecipient[]) {
  return entries.map((entry) => ({
    recipientType: entry.recipientType,
    personKind: entry.recipientType === "person" ? parsePersonKind(entry.personKind) : null,
    personId: entry.recipientType === "person" && entry.personId ? Number(entry.personId) : null,
    teamId: entry.recipientType === "team" && entry.teamId ? Number(entry.teamId) : null,
    compensationPercent: entry.percent,
  }));
}
