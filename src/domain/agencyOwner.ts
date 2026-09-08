import type { PersonKind } from "./allocations";

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
