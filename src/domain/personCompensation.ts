import { formatStatementMonth } from "./dates";
import type { AllocationStatus, PersonKind, RecipientType } from "./allocations";

export type PersonCompensationRow = {
  allocationId: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  recipientType: RecipientType | "team_member";
  roleLabel: string;
  allocationBps: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  teamName: string | null;
};

export function personCompensationRows(input: {
  allocations: Array<{
    id: number;
    groupId: number;
    groupName: string;
    lineOfBusinessId: number;
    lineOfBusinessName: string;
    effectiveStart: string;
    effectiveEnd: string | null;
    status: AllocationStatus;
    entries: Array<{
      recipientType: RecipientType;
      personKind: PersonKind | null;
      personId: number | null;
      teamId: number | null;
      teamName: string | null;
      compensationBps: number;
    }>;
  }>;
  teams?: Array<{
    id: number;
    name: string;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      shareBps: number;
      status: string;
    }>;
  }>;
  personKind: PersonKind;
  personId: number;
}): PersonCompensationRow[] {
  const rows: PersonCompensationRow[] = [];
  for (const allocation of input.allocations) {
    for (const entry of allocation.entries) {
      if (entry.recipientType === "person" && entry.personKind === input.personKind && entry.personId === input.personId) {
        rows.push({
          allocationId: allocation.id,
          groupId: allocation.groupId,
          groupName: allocation.groupName,
          lineOfBusinessId: allocation.lineOfBusinessId,
          lineOfBusinessName: allocation.lineOfBusinessName,
          recipientType: "person",
          roleLabel: input.personKind === "account_manager" ? "Account manager" : "Agent",
          allocationBps: entry.compensationBps,
          effectiveStart: allocation.effectiveStart,
          effectiveEnd: allocation.effectiveEnd,
          status: allocation.status,
          teamName: null,
        });
      }
      if (entry.recipientType === "team" && entry.teamId != null) {
        const team = input.teams?.find((item) => item.id === entry.teamId);
        const member = team?.members.find((item) => (
          item.personKind === input.personKind && item.personId === input.personId && item.status === "active"
        ));
        if (member) {
          rows.push({
            allocationId: allocation.id,
            groupId: allocation.groupId,
            groupName: allocation.groupName,
            lineOfBusinessId: allocation.lineOfBusinessId,
            lineOfBusinessName: allocation.lineOfBusinessName,
            recipientType: "team_member",
            roleLabel: "Team member",
            allocationBps: Math.round((entry.compensationBps * member.shareBps) / 10000),
            effectiveStart: allocation.effectiveStart,
            effectiveEnd: allocation.effectiveEnd,
            status: allocation.status,
            teamName: team?.name ?? entry.teamName,
          });
        }
      }
    }
  }
  return rows.sort((left, right) => (
    left.groupName.localeCompare(right.groupName)
    || left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)
    || right.effectiveStart.localeCompare(left.effectiveStart)
  ));
}

export function personCompensationPeriod(row: Pick<PersonCompensationRow, "effectiveStart" | "effectiveEnd">) {
  return `${formatStatementMonth(row.effectiveStart)} → ${row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : ""}`.trim();
}

export function editAllocationHref(allocationId: number) {
  return `/compensation?allocationId=${allocationId}`;
}
