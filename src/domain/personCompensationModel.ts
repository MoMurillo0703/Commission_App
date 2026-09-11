import { AGENCY_OWNER_DISPLAY_NAME, samePerson, type PersonIdentity } from "./agencyOwner";
import {
  allocationTotals,
  recipientKey,
  validateAllocationEntries,
  type AllocationEntryInput,
  type PersonKind,
} from "./allocations";

export type PeopleFacingRecipient = {
  personKind: PersonKind;
  personId: number;
  name: string;
  compensationBps: number;
  agencyOwner: boolean;
};

export function allocationHasOwnerPersonAndAgency(
  entries: AllocationEntryInput[],
  owner: PersonIdentity | null,
) {
  if (!owner) return false;
  const hasAgency = entries.some((entry) => entry.recipientType === "agency");
  const hasOwnerPerson = entries.some((entry) => (
    entry.recipientType === "person"
    && entry.personKind === owner.personKind
    && entry.personId === owner.personId
  ));
  return hasAgency && hasOwnerPerson;
}

export function persistPeopleSplit(input: {
  people: Array<{ personKind: PersonKind; personId: number; compensationBps: number }>;
  owner: PersonIdentity | null;
}): AllocationEntryInput[] {
  if (!input.owner) {
    throw new Error("Agency owner is not configured for this effective month.");
  }
  const seen = new Set<string>();
  const entries: AllocationEntryInput[] = [];
  for (const person of input.people) {
    const key = `${person.personKind}:${person.personId}`;
    if (seen.has(key)) throw new Error("Each recipient can appear only once in an allocation.");
    seen.add(key);
    if (samePerson(person, input.owner)) {
      if (entries.some((entry) => entry.recipientType === "agency")) {
        throw new Error("Mo and Agency cannot both appear in the same allocation.");
      }
      entries.push({ recipientType: "agency", compensationBps: person.compensationBps });
      continue;
    }
    entries.push({
      recipientType: "person",
      personKind: person.personKind,
      personId: person.personId,
      compensationBps: person.compensationBps,
    });
  }
  validateAllocationEntries(entries, { requireComplete: true });
  return entries;
}

export function peopleFacingRecipients(input: {
  entries: AllocationEntryInput[];
  owner: PersonIdentity | null;
  personName: (kind: PersonKind, id: number) => string;
  ownerDisplayName?: string;
}): PeopleFacingRecipient[] {
  if (allocationHasOwnerPersonAndAgency(input.entries, input.owner)) {
    throw new Error("This allocation names Mo as both a person and Agency. Review is required.");
  }
  return input.entries.flatMap((entry) => {
    if (entry.recipientType === "agency") {
      if (!input.owner) return [];
      return [{
        personKind: input.owner.personKind,
        personId: input.owner.personId,
        name: input.ownerDisplayName ?? AGENCY_OWNER_DISPLAY_NAME,
        compensationBps: entry.compensationBps,
        agencyOwner: true,
      }];
    }
    if (entry.recipientType === "person" && entry.personKind && entry.personId != null) {
      const owner = Boolean(input.owner && samePerson({ personKind: entry.personKind, personId: entry.personId }, input.owner));
      return [{
        personKind: entry.personKind,
        personId: entry.personId,
        name: owner ? (input.ownerDisplayName ?? AGENCY_OWNER_DISPLAY_NAME) : input.personName(entry.personKind, entry.personId),
        compensationBps: entry.compensationBps,
        agencyOwner: owner,
      }];
    }
    return [];
  });
}

export function peopleFacingSummary(recipients: PeopleFacingRecipient[]) {
  return recipients.map((row) => `${row.name} ${row.compensationBps / 100}%`).join(" · ");
}

export function defaultOwnerOnlySplit(owner: PersonIdentity): AllocationEntryInput[] {
  return persistPeopleSplit({
    owner,
    people: [{ personKind: owner.personKind, personId: owner.personId, compensationBps: 10000 }],
  });
}

export function peopleSplitIsComplete(people: Array<{ compensationBps: number }>) {
  return allocationTotals(people).complete;
}

export function peopleCompensationOptions(input: {
  agents: Array<{ id: number; name: string }>;
  accountManagers: Array<{ id: number; name: string }>;
  owner: PersonIdentity | null;
}) {
  return [
    ...input.agents.map((agent) => ({
      personKind: "agent" as const,
      personId: agent.id,
      label: input.owner && samePerson({ personKind: "agent", personId: agent.id }, input.owner)
        ? AGENCY_OWNER_DISPLAY_NAME
        : agent.name,
      agencyOwner: Boolean(input.owner && samePerson({ personKind: "agent", personId: agent.id }, input.owner)),
    })),
    ...input.accountManagers.map((manager) => ({
      personKind: "account_manager" as const,
      personId: manager.id,
      label: input.owner && samePerson({ personKind: "account_manager", personId: manager.id }, input.owner)
        ? AGENCY_OWNER_DISPLAY_NAME
        : manager.name,
      agencyOwner: Boolean(input.owner && samePerson({ personKind: "account_manager", personId: manager.id }, input.owner)),
    })),
  ];
}

export function recipientFingerprint(entries: AllocationEntryInput[]) {
  return entries
    .map((entry) => `${recipientKey(entry)}:${entry.compensationBps}`)
    .sort()
    .join("|");
}
