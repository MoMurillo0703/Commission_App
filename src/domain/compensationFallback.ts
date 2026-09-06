import { FULL_ALLOCATION_BPS, type PayoutRecipientType } from "./allocations";

export type FallbackPayoutCandidate = {
  recipientType: PayoutRecipientType | string;
  allocationId: number | null;
  allocationBps: number;
  compensationCents: number;
};

export type FallbackCommissionCandidate = {
  commissionId: number;
  grossCommissionCents: number;
  agentCompensationCents: number;
  agencyNetCents: number;
  payouts: FallbackPayoutCandidate[];
  hasPriorCorrection: boolean;
};

export type FallbackEligibility = {
  eligible: boolean;
  reason: string | null;
};

function fail(reason: string): FallbackEligibility {
  return { eligible: false, reason };
}

export function classifyAgencyFallback(input: FallbackCommissionCandidate): FallbackEligibility {
  if (input.hasPriorCorrection) return fail("A compensation correction already exists for this commission.");
  if (input.payouts.length !== 1) return fail("Fallback correction requires exactly one payout.");

  const payout = input.payouts[0]!;
  if (payout.recipientType !== "agency") return fail("Fallback correction requires the single payout to be Agency.");
  if (payout.allocationId != null) return fail("Fallback correction requires a null allocation snapshot.");
  if (payout.allocationBps !== FULL_ALLOCATION_BPS) return fail("Fallback correction requires an Agency 100% payout.");
  if (payout.compensationCents !== input.grossCommissionCents) {
    return fail("Fallback correction requires the Agency payout to equal the signed gross commission.");
  }

  if (input.payouts.some((row) => row.recipientType === "person")) return fail("Fallback correction cannot apply when Person payouts exist.");
  if (input.payouts.some((row) => row.recipientType === "team")) return fail("Fallback correction cannot apply when Team payouts exist.");
  if (input.payouts.some((row) => row.recipientType === "team_member")) {
    return fail("Fallback correction cannot apply when Team-member payouts exist.");
  }
  if (input.agentCompensationCents !== 0) return fail("Fallback correction requires header recipient compensation to be zero.");
  if (input.agencyNetCents !== input.grossCommissionCents) {
    return fail("Fallback correction requires Agency Net to equal the signed gross commission.");
  }
  return { eligible: true, reason: null };
}

export function isEligibleAgencyFallback(input: FallbackCommissionCandidate) {
  return classifyAgencyFallback(input).eligible;
}
