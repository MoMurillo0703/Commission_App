import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { rememberCarrierCoverageAlias, listCarrierCoverageAliases } from "./carrierCoverage";
import { rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import { listCommissions } from "./commissions";
import { confirmImportLines } from "./importNamed";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createGroup, listGroups } from "./groups";
import { createLineOfBusiness, listLinesOfBusiness } from "./linesOfBusiness";
import { recoverAutomaticPdfRead } from "./pdfAutomaticRead";
import { createImportStatement, saveImportColumnMapping, saveImportExtractionPath, saveImportPreview } from "./statements";
import { createTestDb } from "@/db/test-db";
import { interpretCaliforniaChoiceStatement } from "@/domain/californiaChoice";
import { collectUnmatchedImportLines } from "@/domain/namedImport";
import { validateMappedRows } from "@/domain/importRows";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { storeStatementFile } from "@/lib/storage";
import { californiaChoiceProductionShapeLines } from "@/domain/californiaChoice.test";
import { choiceBuilderStatementLines } from "../../tests/helpers/pdfFixtures";
import { interpretExtractedPdfPages } from "@/domain/pdfStructureInference";

const pages = [{ pageNumber: 1, text: californiaChoiceProductionShapeLines.join("\n"), lines: californiaChoiceProductionShapeLines }];

describe("CaliforniaChoice production LOB import regression", () => {
  it("keeps Product as LOB, auto-maps commission, and ignores only a legitimate unknown Product", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Cal Choice" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    const chiropractic = await createLineOfBusiness(db, { name: "Chiropractic" });
    const borgens = await createGroup(db, { name: "Borgens Construction" });
    const chimay = await createGroup(db, { name: "Chimay Enterprise" });
    const joses = await createGroup(db, { name: "Joses Ornamental" });
    await rememberCarrierGroupIdentity(db, { carrierId: carrier.id, externalGroupNumber: "86216", groupId: borgens.id });
    await rememberCarrierGroupIdentity(db, { carrierId: carrier.id, externalGroupNumber: "83746", groupId: chimay.id });
    await rememberCarrierGroupIdentity(db, { carrierId: carrier.id, externalGroupNumber: "65884", groupId: joses.id });
    await rememberCarrierCoverageAlias(db, { carrierId: carrier.id, sourceValue: "Chiro", lineOfBusinessId: chiropractic.id });

    const interpreted = interpretCaliforniaChoiceStatement(pages, await listGroups(db), {
      carrierId: carrier.id,
      identities: [
        { carrierId: carrier.id, externalGroupNumber: "86216", groupId: borgens.id },
        { carrierId: carrier.id, externalGroupNumber: "83746", groupId: chimay.id },
        { carrierId: carrier.id, externalGroupNumber: "65884", groupId: joses.id },
      ],
      sourceHint: "Cal Choice - 08 2026.pdf",
    });
    expect(interpreted).toBeTruthy();
    expect(interpreted?.mapping.grossCommission).toBe("Commission Amount");
    expect(interpreted?.mapping.premiumMonth).toBeUndefined();

    const statement = await createImportStatement(db, {
      originalFilename: "Cal Choice - 08 2026.pdf",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "mapped",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("cal-choice-prod-shape")),
      preview: interpreted!.preview,
    });
    await saveImportColumnMapping(db, statement.id, interpreted!.mapping);

    const review = await previewImportPosting(db, statement.id, interpreted!.mapping);
    const unmatchedNames = review.unmatchedLines.map((item) => item.sourceName);
    expect(unmatchedNames).not.toEqual(expect.arrayContaining(["$", "05-26", "08-26", "09-26"]));
    expect(unmatchedNames).toEqual(["Acupuncture"]);
    expect(review.rows.every((row) => row.premiumMonth == null)).toBe(true);
    expect(review.rows.every((row) => (row.notes ?? "").includes("Carrier paid month:"))).toBe(true);
    expect(review.readiness.blockers.filter((item) => item.kind === "mapping")).toEqual([]);
    expect(review.unmatchedGroups).toHaveLength(0);
    expect(review.rows.some((row) => row.exceptions.some((item) => item.startsWith("Map a gross commission")))).toBe(false);
    expect(review.rows.find((row) => row.importedLineName === "Chiro")?.lineOfBusinessId).toBe(chiropractic.id);
    expect(review.rows.find((row) => row.importedLineName === "Medical")?.lineOfBusinessId).toBe(medical.id);
    expect(review.rows.some((row) => row.grossCommissionCents === -50)).toBe(true);
    expect(review.rows.every((row) => row.compensationBps === 0 || row.importedLineName === "Acupuncture")).toBe(true);

    const confirmed = await confirmImportLines(db, statement.id, interpreted!.mapping, [
      { key: review.unmatchedLines[0]!.key, action: "ignore" },
    ]);
    expect(confirmed.unmatchedLines).toHaveLength(0);
    expect((await listLinesOfBusiness(db)).map((item) => item.name)).not.toContain("Acupuncture");
    expect((await listCarrierCoverageAliases(db, carrier.id)).map((item) => item.sourceValue)).toEqual(["chiro"]);
    expect(confirmed.rows.filter((row) => row.status === "ignored")).toHaveLength(1);
    expect(confirmed.readiness.canContinue).toBe(true);

    const posted = await postImportStatement(db, statement.id, interpreted!.mapping);
    expect(posted.postedCount).toBe(confirmed.rows.filter((row) => row.status === "ready").length);
    expect((await listCommissions(db)).every((row) => row.statementMonth === "2026-09")).toBe(true);
    expect((await listCommissions(db)).every((row) => row.premiumMonth == null)).toBe(true);
    expect((await listCommissions(db)).some((row) => (row.notes ?? "").includes("ADJ CD: RV"))).toBe(true);
  });

  it("does not offer $, months, or currency as unmatched LOBs when a generic shifted mapping is used", () => {
    const rows = validateMappedRows([{
      name: "Page 1",
      headerRowNumber: 1,
      rowCount: 2,
      headers: ["NUMBER", "COMPANY NAME", "PRODUCT", "PREMIUM", "%", "AMOUNT", "CD"],
      groupNameHeader: "COMPANY NAME",
      groupNumberHeader: "NUMBER",
      premiumMonthHeader: null,
      rows: [
        {
          rowNumber: 1,
          values: { NUMBER: "86216", "COMPANY NAME": "BORGENS CONSTRUCTION INC", PRODUCT: "08-26", PREMIUM: "Medical", "%": "$", AMOUNT: "1,724.85", CD: "5.0" },
          premiumMonth: null,
          group: { status: "new_group", groupId: null, groupName: null, sourceName: "BORGENS CONSTRUCTION INC", sourceNumber: "86216" },
        },
        {
          rowNumber: 2,
          values: { NUMBER: "09-26", "COMPANY NAME": "Chiro", PRODUCT: "$", PREMIUM: "45.24", "%": "6.5", AMOUNT: "$", CD: "2.96" },
          premiumMonth: null,
          group: { status: "new_group", groupId: null, groupName: null, sourceName: "Chiro", sourceNumber: "09-26" },
        },
      ],
    }], {
      groupName: "COMPANY NAME",
      lineOfBusiness: "PRODUCT",
      premium: "PREMIUM",
    }, "2026-09", {
      groups: [],
      carriers: [{ id: 2, name: "Cal Choice" }],
      linesOfBusiness: [{ id: 3, name: "Medical" }],
      agents: [],
      statementCarrier: { id: 2, name: "Cal Choice" },
    });
    expect(collectUnmatchedImportLines(rows.map((row) => ({ exceptions: row.exceptions, importedName: row.importedLineName })))).toEqual([]);
    expect(rows.every((row) => row.exceptions.some((item) => item.includes("could not be read")))).toBe(true);
  });

  it("recovers a stored generic Cal Choice misread into the interpreter preview", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Cal Choice" });
    const leftover = await createImportStatement(db, {
      originalFilename: "Cal Choice - 08 2026.pdf",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "mapped",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("cal-choice-misread")),
      preview: {
        sheets: [{
          name: "Page 1",
          headerRowNumber: 1,
          rowCount: 1,
          headers: ["NUMBER", "COMPANY NAME", "PRODUCT", "PREMIUM", "%", "AMOUNT", "CD"],
          groupNameHeader: "COMPANY NAME",
          groupNumberHeader: "NUMBER",
          premiumMonthHeader: null,
          rows: [{
            rowNumber: 1,
            values: { NUMBER: "86216", "COMPANY NAME": "BORGENS CONSTRUCTION INC", PRODUCT: "08-26", PREMIUM: "Medical", "%": "$", AMOUNT: "86.24", CD: "5.0" },
            premiumMonth: null,
            group: { status: "new_group", groupId: null, groupName: null, sourceName: "BORGENS CONSTRUCTION INC", sourceNumber: "86216" },
          }],
        }],
        unmatchedGroups: [],
        rowCount: 1,
        newGroupCount: 1,
        pdf: { classification: "readable", pageCount: 1 },
      },
    });
    const extractionPath = await storeStatementFile(leftover.id, "extraction.json", new TextEncoder().encode(JSON.stringify({
      classification: "readable",
      pageCount: 1,
      pages,
    })));
    const stored = await saveImportExtractionPath(db, leftover.id, extractionPath);
    await saveImportColumnMapping(db, leftover.id, {
      groupName: "COMPANY NAME",
      lineOfBusiness: "PRODUCT",
      premium: "PREMIUM",
      grossCommission: null,
    });
    const recovered = await recoverAutomaticPdfRead(db, stored);
    expect(recovered.preview?.pdf?.groupMatchStrategy).toBe("carrier_group_identity");
    expect(recovered.preview?.sheets[0]?.rows.map((row) => row.values.Product)).not.toEqual(expect.arrayContaining(["$", "05-26", "08-26", "09-26"]));
    expect(recovered.columnMapping).toMatchObject({
      lineOfBusiness: "Product",
      grossCommission: "Commission Amount",
    });
  });

  it("leaves Choice Builder interpretation unchanged", () => {
    const interpreted = interpretExtractedPdfPages([{
      pageNumber: 1,
      text: choiceBuilderStatementLines.join("\n"),
      lines: choiceBuilderStatementLines,
    }], []);
    expect(interpreted?.preview.rowCount).toBe(6);
    expect(interpreted?.mapping.groupName).toBe("Company Name");
    expect(interpreted?.preview.pdf?.groupMatchStrategy).not.toBe("carrier_group_identity");
  });
});
