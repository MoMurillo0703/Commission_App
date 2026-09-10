import { continueImportBlockedReason, isStatementFullyPosted, type StatementBlocker, type StatementReadiness } from "./statementReadiness";

export type PersistedStatementPostRef = {
  status?: string | null;
  postedRowCount?: number | null;
};

export type StatementPostHttpBody = {
  posted?: boolean;
  postedCount?: number;
  alreadyPostedCount?: number;
  postedGrossCents?: number;
  commissionIds?: number[];
  message?: string;
  blockers?: Array<{ message?: string } | StatementBlocker> | unknown;
  statement?: PersistedStatementPostRef | null;
  createdCount?: number;
  matchedCount?: number;
  reusedCount?: number;
  remainingUnmatchedCount?: number;
  readiness?: StatementReadiness | null;
  unmatchedGroups?: unknown[];
  unmatchedLines?: unknown[];
  unmatchedAgents?: unknown[];
};

export function persistedFinancialPostSucceeded(input: {
  statement?: PersistedStatementPostRef | null;
}): boolean {
  const status = input.statement?.status;
  const persistedRows = input.statement?.postedRowCount ?? 0;
  return (status === "posted" || status === "partially_posted") && persistedRows > 0;
}

export function acceptedPostHttpBody(body: StatementPostHttpBody | null | undefined): boolean {
  if (!body || body.posted !== true) return false;
  return persistedFinancialPostSucceeded(body);
}

export function isPersistedStatementFullyPosted(input: {
  readiness?: StatementReadiness | null;
  statement?: PersistedStatementPostRef | null;
  unmatchedCount?: number;
}): boolean {
  if (!persistedFinancialPostSucceeded(input)) return false;
  if ((input.unmatchedCount ?? 0) > 0) return false;
  return isStatementFullyPosted(input.readiness ?? null);
}

export function blockedPostMessage(readiness: StatementReadiness | null | undefined, blockedCount = 0): string {
  const detail = readiness?.reasons.length
    ? readiness.reasons.join(" ")
    : blockedCount > 0
      ? `${blockedCount} row${blockedCount === 1 ? " is" : "s are"} blocked.`
      : "No rows were ready to post.";
  return `This statement was not posted. ${detail} No commission records were written.`;
}

export function postRejectionUserMessage(
  serverMessage: string,
  blockers?: StatementPostHttpBody["blockers"],
): string {
  const blockerText = Array.isArray(blockers)
    ? blockers.flatMap((item) => {
      if (!item || typeof item !== "object" || !("message" in item)) return [];
      const message = String(item.message ?? "").trim();
      return message ? [message] : [];
    })
    : [];
  const extra = blockerText.filter((item) => !serverMessage.includes(item));
  const text = [serverMessage, ...extra].filter(Boolean).join(" ").trim();
  if (/this statement was not posted/i.test(text) && /no commission records were written/i.test(text)) {
    return text;
  }
  return `${text} This statement was not posted. No commission records were written.`;
}

export function sectionConfirmSuccessMessage(review: {
  createdCount?: number;
  matchedCount?: number;
  reusedCount?: number;
  remainingUnmatchedCount?: number;
}): string {
  const saved = (review.createdCount ?? 0) + (review.matchedCount ?? 0) + (review.reusedCount ?? 0);
  const remaining = review.remainingUnmatchedCount ?? 0;
  const savedText = saved > 0
    ? `Saved ${saved} review decision${saved === 1 ? "" : "s"}.`
    : "Review decisions were saved.";
  const remainingText = remaining > 0
    ? ` ${remaining} item${remaining === 1 ? "" : "s"} still need review.`
    : "";
  return `${savedText}${remainingText} This statement is not posted.`;
}

export type StatementPostBannerKind = "posted" | "ready" | "needs_review" | "error";

export function statementPostBannerKind(input: {
  httpOk?: boolean;
  error?: string | null;
  readiness?: StatementReadiness | null;
  statement?: PersistedStatementPostRef | null;
  unmatchedCount?: number;
}): StatementPostBannerKind {
  if (input.error?.trim() || input.httpOk === false) return "error";
  if (isPersistedStatementFullyPosted(input)) return "posted";
  if (input.readiness?.canContinue) return "ready";
  return "needs_review";
}

export function shouldCallOnPosted(input: { httpOk: boolean; body: StatementPostHttpBody | null | undefined }): boolean {
  return input.httpOk && acceptedPostHttpBody(input.body);
}

export function postButtonBlockedReason(readiness: StatementReadiness | null): string | null {
  if (readiness?.canContinue) return null;
  return continueImportBlockedReason(readiness);
}
