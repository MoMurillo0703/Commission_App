import { paidMonthInRange } from "./dates";
import { persistPeopleSplit } from "./personCompensationModel";
import { validateTeamMemberShares, type AllocationEntryInput, type PersonKind } from "./allocations";
import type { PersonIdentity } from "./agencyOwner";

export type TemplateTeamMember = {
  personKind: PersonKind;
  personId: number;
  shareBps: number;
  status: string;
  effectiveStart: string;
  effectiveEnd: string | null;
};

export type TemplateTeam = {
  id: number;
  name: string;
  status?: string;
  members: TemplateTeamMember[];
};

export function resolveTeamTemplateMembers(team: TemplateTeam, asOfMonth: string) {
  if ((team.status ?? "active") !== "active") {
    throw new Error(`${team.name} is not an active compensation template.`);
  }
  const members = team.members.filter((member) => (
    member.status === "active"
    && paidMonthInRange(asOfMonth, member.effectiveStart, member.effectiveEnd)
  ));
  if (members.length === 0) {
    throw new Error(`${team.name} has no active members for ${asOfMonth}.`);
  }
  validateTeamMemberShares(members);
  return members;
}

export function expandTeamTemplate(input: {
  team: TemplateTeam;
  asOfMonth: string;
  owner: PersonIdentity | null;
}): AllocationEntryInput[] {
  const members = resolveTeamTemplateMembers(input.team, input.asOfMonth);
  return persistPeopleSplit({
    owner: input.owner,
    people: members.map((member) => ({
      personKind: member.personKind,
      personId: member.personId,
      compensationBps: member.shareBps,
    })),
  });
}
