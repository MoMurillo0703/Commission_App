import { paidMonthInRange } from "./dates";
import { AGENCY_OWNER_DISPLAY_NAME, personKey, samePerson, type PersonIdentity } from "./agencyOwner";
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

export function allocationHasOwnerAndAgencyDuplicate(
  entries: AllocationEntryInput[],
  owner: PersonIdentity | null,
  teams: Array<{
    id: number;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      status: string;
      effectiveStart: string;
      effectiveEnd: string | null;
    }>;
  }>,
  asOfMonth: string,
) {
  if (!owner) return false;
  if (!entries.some((entry) => entry.recipientType === "agency")) return false;
  if (allocationHasOwnerPersonAndAgency(entries, owner)) return true;
  for (const entry of entries) {
    if (entry.recipientType !== "team" || entry.teamId == null) continue;
    const team = teams.find((item) => item.id === entry.teamId);
    if (!team) continue;
    const members = team.members.filter((member) => (
      member.status === "active"
      && paidMonthInRange(asOfMonth, member.effectiveStart, member.effectiveEnd)
    ));
    if (members.some((member) => samePerson(member, owner))) return true;
  }
  return false;
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

function expandPeopleFacingRecipients(input: {
  entries: AllocationEntryInput[];
  owner: PersonIdentity | null;
  personName: (kind: PersonKind, id: number) => string;
  ownerDisplayName?: string;
  teams?: Array<{
    id: number;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      name?: string;
      status: string;
      effectiveStart: string;
      effectiveEnd: string | null;
      shareBps: number;
    }>;
  }>;
  asOfMonth?: string;
}): PeopleFacingRecipient[] {
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
    if (entry.recipientType === "team" && entry.teamId != null && input.asOfMonth) {
      const team = (input.teams ?? []).find((item) => item.id === entry.teamId);
      if (!team) return [];
      return team.members
        .filter((member) => (
          member.status === "active"
          && paidMonthInRange(input.asOfMonth!, member.effectiveStart, member.effectiveEnd)
        ))
        .map((member) => {
          const owner = Boolean(input.owner && samePerson(member, input.owner));
          return {
            personKind: member.personKind,
            personId: member.personId,
            name: owner
              ? (input.ownerDisplayName ?? AGENCY_OWNER_DISPLAY_NAME)
              : (member.name ?? input.personName(member.personKind, member.personId)),
            compensationBps: Math.round((entry.compensationBps * member.shareBps) / 10000),
            agencyOwner: owner,
          };
        });
    }
    return [];
  });
}

export function peopleFacingRecipients(input: {
  entries: AllocationEntryInput[];
  owner: PersonIdentity | null;
  personName: (kind: PersonKind, id: number) => string;
  ownerDisplayName?: string;
  teams?: Array<{
    id: number;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      name?: string;
      status: string;
      effectiveStart: string;
      effectiveEnd: string | null;
      shareBps: number;
    }>;
  }>;
  asOfMonth?: string;
}): PeopleFacingRecipient[] {
  if (allocationHasOwnerAndAgencyDuplicate(input.entries, input.owner, input.teams ?? [], input.asOfMonth ?? "")) {
    throw new Error("This allocation names Mo as both a person and Agency. Review is required.");
  }
  if (input.entries.some((entry) => entry.recipientType === "agency") && !input.owner) {
    throw new Error("Agency owner is not configured for this effective month.");
  }
  return expandPeopleFacingRecipients(input);
}

export function economicPeopleFromAllocation(input: Parameters<typeof expandPeopleFacingRecipients>[0]) {
  const seen = new Set<string>();
  return expandPeopleFacingRecipients(input).filter((row) => {
    const key = personKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
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
