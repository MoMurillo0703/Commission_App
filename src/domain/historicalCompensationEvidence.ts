export const CAL_CHOICE_TEAM_ALLOCATION_BPS = {
  john: 7000,
  moAgency: 2000,
  laura: 500,
  nancy: 500,
} as const;

export const CAL_CHOICE_TEAM_TOTAL_BPS = 10000;

export type HistoricalCompensationClassification =
  | {
    status: "prepare_team_allocation";
    johnShareBps: number;
    allocationBps: typeof CAL_CHOICE_TEAM_ALLOCATION_BPS;
  }
  | {
    status: "needs_product_owner";
    reason: string;
    johnShareBps: number | null;
  }
  | {
    status: "already_settled";
  };

export function classifyHistoricalCompensationEvidence(input: {
  alreadySettled?: boolean;
  johnShareBps: number | null;
  remainingRecipientsEstablished: boolean;
  calChoiceTeamCoversPaidMonth?: boolean;
}): HistoricalCompensationClassification {
  if (input.alreadySettled) return { status: "already_settled" };
  if (input.johnShareBps == null) {
    return {
      status: "needs_product_owner",
      reason: "Source does not establish John's historical percentage.",
      johnShareBps: null,
    };
  }
  const canUseCalChoiceTeam = input.johnShareBps === CAL_CHOICE_TEAM_ALLOCATION_BPS.john
    && input.remainingRecipientsEstablished
    && input.calChoiceTeamCoversPaidMonth === true;
  if (canUseCalChoiceTeam) {
    return {
      status: "prepare_team_allocation",
      johnShareBps: input.johnShareBps,
      allocationBps: CAL_CHOICE_TEAM_ALLOCATION_BPS,
    };
  }
  if (input.johnShareBps === CAL_CHOICE_TEAM_ALLOCATION_BPS.john && !input.remainingRecipientsEstablished) {
    return {
      status: "needs_product_owner",
      reason: "Source establishes John 70% but does not establish the remaining 30% recipients for a 100% allocation.",
      johnShareBps: input.johnShareBps,
    };
  }
  return {
    status: "needs_product_owner",
    reason: "Source establishes a John percentage without a complete 100% historical allocation.",
    johnShareBps: input.johnShareBps,
  };
}

export function johnShareFromSourceLine(agencyCommissionCents: number, johnCompensationCents: number) {
  if (!Number.isInteger(agencyCommissionCents) || agencyCommissionCents === 0) return null;
  if (!Number.isInteger(johnCompensationCents)) return null;
  return Math.round((johnCompensationCents * 10000) / agencyCommissionCents);
}
