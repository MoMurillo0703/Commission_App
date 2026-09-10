import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { listCommissions } from "./commissions";
import { confirmImportGroups, reviewImportGroups } from "./importGroups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { recoverAutomaticPdfRead } from "./pdfAutomaticRead";
import { createImportStatement, getImportStatement, saveImportExtractionPath } from "./statements";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { interpretBeamStatement } from "@/domain/beamStatement";
import { storeStatementFile } from "@/lib/storage";
import { beamStatementLayoutLines } from "../../tests/helpers/beamStatementLines";

const beamMapping = {
  groupName: "Company Name",
  groupNumber: "Group Number",
  lineOfBusiness: "Policy",
  premium: "Premium",
  grossCommission: "Comm. amt.",
  premiumMonth: "Invoicing Period",
};

describe("statement intake stabilization workflow", () => {
  it("resumes a Beam statement at review without duplicating rows or posting", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Beam" });
    await createLineOfBusiness(db, { name: "Medical" });
    const interpreted = interpretBeamStatement([{
      pageNumber: 1,
      text: beamStatementLayoutLines.join("\n"),
      lines: beamStatementLayoutLines,
    }], []);
    expect(interpreted?.preview.rowCount).toBeGreaterThan(0);
    const statement = await createImportStatement(db, {
      originalFilename: "Beam 09 2026 Commission Report.pdf",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "mapped",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("beam-resume-workflow")),
      preview: interpreted!.preview,
    });
    const extractionPath = await storeStatementFile(statement.id, "extraction.json", new TextEncoder().encode(JSON.stringify({
      classification: "readable",
      pageCount: 1,
      pages: [{ pageNumber: 1, lines: beamStatementLayoutLines }],
    })));
    await saveImportExtractionPath(db, statement.id, extractionPath);

    const review = await reviewImportGroups(db, statement.id, interpreted!.mapping);
    const first = review.unmatchedGroups[0];
    expect(first).toBeTruthy();
    expect(review.unmatchedGroups.some((group) => /^CA\d{5}$/i.test(group.sourceName ?? ""))).toBe(false);
    const confirmed = await confirmImportGroups(db, statement.id, interpreted!.mapping, [
      { key: first!.key, action: "ignore" },
    ]);
    expect(confirmed.remainingUnmatchedCount).toBeGreaterThan(0);
    expect(confirmed.rows.some((row) => row.status === "ignored")).toBe(true);
    expect(confirmed.rows.some((row) => row.status === "blocked")).toBe(true);
    expect(await listCommissions(db)).toHaveLength(0);

    const stored = await getImportStatement(db, statement.id);
    const resumed = await recoverAutomaticPdfRead(db, stored!);
    expect(resumed.id).toBe(statement.id);
    expect(resumed.preview?.rowCount).toBe(interpreted!.preview.rowCount);
    expect(resumed.preview?.groupResolutions?.some((item) => item.key === first!.key && item.action === "ignore")).toBe(true);

    const afterResume = await previewImportPosting(db, statement.id, beamMapping);
    expect(afterResume.rows.filter((row) => row.status === "ignored").length).toBe(confirmed.rows.filter((row) => row.status === "ignored").length);
    expect(afterResume.unmatchedGroups.length).toBe(confirmed.remainingUnmatchedCount);
    expect(await listCommissions(db)).toHaveLength(0);
    await expect(postImportStatement(db, statement.id, beamMapping)).rejects.toThrow();
    expect(await listCommissions(db)).toHaveLength(0);
  });
});
