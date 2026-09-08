import type { PersonKind } from "./allocations";
import { formatPaidMonthLong, paidMonthInRange } from "./dates";

export type PersonIdentity = {
  personKind: PersonKind;
  personId: number;
};

export function samePerson(left: PersonIdentity | null | undefined, right: PersonIdentity | null | undefined) {
  return Boolean(
    left
    && right
    && left.personKind === right.personKind
    && left.personId === right.personId,
  );
}

export function personKey(person: PersonIdentity) {
  return `${person.personKind}:${person.personId}`;
}

export function parsePersonKey(value: string): PersonIdentity | null {
  const [personKind, rawId] = value.split(":");
  const personId = Number(rawId);
  if ((personKind !== "agent" && personKind !== "account_manager") || !Number.isInteger(personId) || personId <= 0) {
    return null;
  }
  return { personKind, personId };
}

export const AGENCY_OWNER_LABEL = "Mo / Agency";

export type AgencyCompensationOwnerPeriod = {
  id?: number;
  identity: PersonIdentity;
  effectiveStartMonth: string;
  effectiveEndMonth: string | null;
};

export function ownerIdentityFromFks(
  agentId: number | null | undefined,
  accountManagerId: number | null | undefined,
): PersonIdentity | null {
  if (agentId != null && accountManagerId == null) return { personKind: "agent", personId: agentId };
  if (accountManagerId != null && agentId == null) {
    return { personKind: "account_manager", personId: accountManagerId };
  }
  return null;
}

export function agencyOwnerForPaidMonth(
  owners: AgencyCompensationOwnerPeriod[],
  paidMonth: string,
): PersonIdentity | null {
  const match = owners.find((owner) => (
    paidMonthInRange(paidMonth, owner.effectiveStartMonth, owner.effectiveEndMonth)
  ));
  return match?.identity ?? null;
}

export function ownerGapWarning(months: string[]) {
  const unique = [...new Set(months)].sort();
  if (unique.length === 0) return null;
  const labels = unique.map((month) => formatPaidMonthLong(month));
  if (labels.length === 1) return `Agency owner is not configured for ${labels[0]}.`;
  return `Agency owner is not configured for ${labels.join(", ")}.`;
}

export function payableOwnerGapMessage(months: string[]) {
  const warning = ownerGapWarning(months);
  return warning ? `NOT PAYABLE-READY — ${warning}` : null;
}
