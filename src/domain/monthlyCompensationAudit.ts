import { formatCents } from "./money";

export function monthlyAuditStatusCopy(payableReady: boolean, needsReviewMessage: string | null) {
  if (payableReady) return "This paid month reconciles to the appropriate people.";
  return needsReviewMessage
    ? `This paid month needs review. ${needsReviewMessage.replace(/^NOT PAYABLE-READY — /i, "")}`
    : "This paid month needs review.";
}

export function monthlyAuditSummaryRows(input: {
  postedCommissionCount: number;
  grossCents: number;
  moAgencyCents: number;
  named: Array<{ label: string; cents: number }>;
  otherCents: number;
  fallbackAgencyCents: number;
  legacyNoPayoutCents: number;
  inconsistentCents: number;
  underDistributedCents: number;
  overDistributedCents: number;
  unclassifiedCents: number;
  differenceCents: number;
}) {
  return [
    { label: "Commissions received", value: String(input.postedCommissionCount) },
    { label: "Gross commissions received", value: formatCents(input.grossCents) },
    { label: "Mo", value: formatCents(input.moAgencyCents) },
    ...input.named.map((person) => ({ label: person.label, value: formatCents(person.cents) })),
    { label: "Other people", value: formatCents(input.otherCents) },
    { label: "Needs review — historical Agency records", value: formatCents(input.fallbackAgencyCents) },
    { label: "Needs review — missing payout snapshot", value: formatCents(input.legacyNoPayoutCents) },
    { label: "Needs review — unresolved Agency share", value: formatCents(input.inconsistentCents) },
    { label: "Under-distributed", value: formatCents(input.underDistributedCents) },
    { label: "Over-distributed", value: formatCents(input.overDistributedCents) },
    { label: "Unclassified", value: formatCents(input.unclassifiedCents) },
    { label: "Difference", value: formatCents(input.differenceCents) },
  ];
}
