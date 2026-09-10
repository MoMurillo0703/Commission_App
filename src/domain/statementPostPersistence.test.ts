import { describe, expect, it } from "vitest";
import { statementReadiness } from "./statementReadiness";
import {
  acceptedPostHttpBody,
  blockedPostMessage,
  isPersistedStatementFullyPosted,
  persistedFinancialPostSucceeded,
  postRejectionUserMessage,
  sectionConfirmSuccessMessage,
  shouldCallOnPosted,
  statementPostBannerKind,
} from "./statementPostPersistence";

const unmatchedReadiness = statementReadiness({
  unmatchedGroups: [{ key: "name:beam-co", sourceName: "Beam Co", sourceNumber: "CA1", rowCount: 45 }],
  unmatchedLines: [{ key: "name:smartpremium", sourceName: "SmartPremium", rowCount: 45 }],
  readyCount: 0,
  blockedCount: 45,
  postedCount: 0,
});

const postedReadiness = statementReadiness({
  readyCount: 0,
  blockedCount: 0,
  postedCount: 45,
});

describe("statement post persistence presentation", () => {
  it("does not treat unresolved review as a persisted post", () => {
    expect(persistedFinancialPostSucceeded({
      statement: { status: "mapped", postedRowCount: 0 },
    })).toBe(false);
    expect(isPersistedStatementFullyPosted({
      readiness: unmatchedReadiness,
      statement: { status: "mapped", postedRowCount: 0 },
      unmatchedCount: 2,
    })).toBe(false);
    expect(statementPostBannerKind({
      readiness: unmatchedReadiness,
      statement: { status: "mapped", postedRowCount: 0 },
      unmatchedCount: 2,
    })).toBe("needs_review");
  });

  it("rejected posting cannot render or return success", () => {
    const blockedBody = {
      posted: false as const,
      message: blockedPostMessage(unmatchedReadiness, 45),
      blockers: unmatchedReadiness.blockers,
      statement: { status: "mapped", postedRowCount: 0 },
      postedCount: 0,
    };
    expect(acceptedPostHttpBody(blockedBody)).toBe(false);
    expect(shouldCallOnPosted({ httpOk: false, body: blockedBody })).toBe(false);
    expect(statementPostBannerKind({
      httpOk: false,
      error: postRejectionUserMessage(blockedBody.message, blockedBody.blockers),
      readiness: unmatchedReadiness,
      statement: blockedBody.statement,
    })).toBe("error");
    expect(statementPostBannerKind({
      httpOk: true,
      readiness: unmatchedReadiness,
      statement: { status: "mapped", postedRowCount: 0 },
    })).not.toBe("posted");
  });

  it("does not treat section confirmation or createdCount as a financial post", () => {
    expect(sectionConfirmSuccessMessage({ createdCount: 22, remainingUnmatchedCount: 45 })).toMatch(/not posted/i);
    expect(sectionConfirmSuccessMessage({ createdCount: 22 })).not.toMatch(/commission record/i);
    expect(acceptedPostHttpBody({
      createdCount: 22,
      statement: { status: "mapped", postedRowCount: 0 },
    })).toBe(false);
    expect(statementPostBannerKind({
      readiness: unmatchedReadiness,
      statement: { status: "mapped", postedRowCount: 0 },
    })).not.toBe("posted");
  });

  it("reports success only when the statement is persisted as posted", () => {
    const body = {
      posted: true as const,
      postedCount: 45,
      postedGrossCents: 132963,
      statement: { status: "posted" as const, postedRowCount: 45 },
    };
    expect(acceptedPostHttpBody(body)).toBe(true);
    expect(shouldCallOnPosted({ httpOk: true, body })).toBe(true);
    expect(isPersistedStatementFullyPosted({
      readiness: postedReadiness,
      statement: body.statement,
      unmatchedCount: 0,
    })).toBe(true);
    expect(statementPostBannerKind({
      httpOk: true,
      readiness: postedReadiness,
      statement: body.statement,
      unmatchedCount: 0,
    })).toBe("posted");
  });

  it("surfaces server failure visibly and never as posted", () => {
    const message = postRejectionUserMessage("Something went wrong.");
    expect(message).toMatch(/not posted/i);
    expect(message).toMatch(/no commission records were written/i);
    expect(statementPostBannerKind({
      httpOk: false,
      error: message,
      readiness: postedReadiness,
      statement: { status: "mapped", postedRowCount: 0 },
    })).toBe("error");
    expect(shouldCallOnPosted({ httpOk: false, body: { posted: true, statement: { status: "posted", postedRowCount: 45 } } })).toBe(false);
  });

  it("does not treat HTTP 200 with mapped/zero rows as success", () => {
    expect(acceptedPostHttpBody({
      posted: true,
      postedCount: 0,
      statement: { status: "mapped", postedRowCount: 0 },
    })).toBe(false);
    expect(shouldCallOnPosted({
      httpOk: true,
      body: { postedCount: 0, statement: { status: "mapped", postedRowCount: 0 } },
    })).toBe(false);
  });
});
