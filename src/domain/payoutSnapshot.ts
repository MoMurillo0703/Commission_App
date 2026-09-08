import { stableJson } from "./compensationCorrection";

export type PayoutIdentitySnapshot = {
  recipientType: string;
  personKind: string | null;
  personId: number | null;
  personName: string | null;
  teamId: number | null;
  teamName: string | null;
  parentPayoutId: number | null;
  allocationId: number | null;
  allocationBps: number;
  teamInternalBps: number | null;
  compensationCents: number;
};

export function payoutIdentitySnapshot(payout: {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  personName?: string | null;
  teamId?: number | null;
  teamName?: string | null;
  parentPayoutId?: number | null;
  allocationId?: number | null;
  allocationBps: number;
  teamInternalBps?: number | null;
  compensationCents: number;
}): PayoutIdentitySnapshot {
  return {
    recipientType: payout.recipientType,
    personKind: payout.personKind ?? null,
    personId: payout.personId ?? null,
    personName: payout.personName ?? null,
    teamId: payout.teamId ?? null,
    teamName: payout.teamName ?? null,
    parentPayoutId: payout.parentPayoutId ?? null,
    allocationId: payout.allocationId ?? null,
    allocationBps: payout.allocationBps,
    teamInternalBps: payout.teamInternalBps ?? null,
    compensationCents: payout.compensationCents,
  };
}

export function payoutIdentityFingerprint(payouts: Array<Parameters<typeof payoutIdentitySnapshot>[0]>) {
  return stableJson(
    [...payouts]
      .map(payoutIdentitySnapshot)
      .sort((left, right) => (
        left.recipientType.localeCompare(right.recipientType)
        || (left.personKind ?? "").localeCompare(right.personKind ?? "")
        || (left.personId ?? 0) - (right.personId ?? 0)
        || (left.teamId ?? 0) - (right.teamId ?? 0)
        || left.allocationBps - right.allocationBps
        || left.compensationCents - right.compensationCents
      )),
  );
}

export function assertPayoutSnapshotsUnchanged(
  before: PayoutIdentitySnapshot[],
  after: PayoutIdentitySnapshot[],
) {
  if (before.length !== after.length) {
    throw new Error("Repair refused because payout history changed.");
  }
  for (const [index, payout] of before.entries()) {
    const next = after[index];
    if (!next || stableJson(payout) !== stableJson(next)) {
      throw new Error("Repair refused because payout identity changed.");
    }
  }
}
