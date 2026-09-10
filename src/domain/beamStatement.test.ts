import { describe, expect, it } from "vitest";
import { interpretExtractedPdfPages } from "./pdfStructureInference";
import {
  interpretBeamStatement,
  isBeamGroupNumber,
  looksLikeBeamStatement,
  parseBeamLines,
  previewLooksLikeMisreadBeam,
} from "./beamStatement";
import { beamStatementLayoutLines } from "../../tests/helpers/beamStatementLines";
import { californiaChoiceProductionShapeLines } from "./californiaChoice.test";
import { choiceBuilderStatementLines } from "../../tests/helpers/pdfFixtures";

const noticedGroupNumbers = [
  "CA01798",
  "CA02433",
  "CA02442",
  "CA02483",
  "CA06114",
  "CA06262",
  "CA07765",
  "CA13347",
];

describe("Beam company name + CA##### group identity", () => {
  it("treats wrapped company name and CA##### as one group identity", () => {
    const records = parseBeamLines(beamStatementLayoutLines);
    const names = [...new Set(records.map((record) => record.groupName))];
    const numbers = [...new Set(records.map((record) => record.groupNumber))];

    expect(records.some((record) => record.groupName === "Example Electrical & Telecom")).toBe(true);
    expect(records.find((record) => record.groupName === "Example Electrical & Telecom")?.groupNumber).toBe("CA04274");
    expect(records.find((record) => record.groupName === "Example Resource Conservation District")?.groupNumber).toBe("CA03805");
    expect(records.find((record) => record.groupName === "Example Heavy Haul & Tow")?.groupNumber).toBe("CA14231");
    expect(records.find((record) => record.groupName === "Example Immigrant Services Inc.")?.groupNumber).toBe("CA01406");
    expect(records.filter((record) => record.groupName === "Example Law")).toHaveLength(3);
    expect(names.some((name) => isBeamGroupNumber(name))).toBe(false);
    expect(numbers).toEqual(expect.arrayContaining(noticedGroupNumbers));
    expect(records.every((record) => record.sourceText.includes(record.groupName.split(" ")[0]!))).toBe(true);
  });

  it("does not create standalone Groups from CA##### tokens or wrap fragments", () => {
    const pages = [{ pageNumber: 1, text: beamStatementLayoutLines.join("\n"), lines: beamStatementLayoutLines }];
    expect(looksLikeBeamStatement(pages, "Beam 09 2026 Commission Report.pdf")).toBe(true);
    const interpreted = interpretBeamStatement(pages, []);
    const names = interpreted?.preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values["Company Name"])) ?? [];
    const unmatched = interpreted?.preview.unmatchedGroups.map((group) => group.sourceName || group.sourceNumber) ?? [];
    expect(interpreted?.preview.pdf?.groupMatchStrategy).toBe("carrier_group_identity");
    expect(names.some((name) => isBeamGroupNumber(name))).toBe(false);
    expect(unmatched.some((name) => isBeamGroupNumber(name))).toBe(false);
    expect(unmatched).not.toEqual(expect.arrayContaining(["Telecom", "Tow", "Inc."]));
    expect(interpreted?.preview.sheets[0]?.rows.every((row) => row.values["Group Number"] && isBeamGroupNumber(row.values["Group Number"]))).toBe(true);
    expect(interpretExtractedPdfPages(pages, [])?.preview.rowCount).toBe(interpreted?.preview.rowCount);
  });

  it("prefers a confirmed carrier-scoped Beam Group Number over a similar name", () => {
    const pages = [{ pageNumber: 1, text: beamStatementLayoutLines.join("\n"), lines: beamStatementLayoutLines }];
    const matched = interpretBeamStatement(pages, [
      { id: 11, name: "Example Law LLC", groupNumber: null },
      { id: 12, name: "Example Law", groupNumber: null },
    ], {
      carrierId: 9,
      identities: [{ carrierId: 9, externalGroupNumber: "ca02483", groupId: 11 }],
    });
    const lawRows = matched?.preview.sheets[0]?.rows.filter((row) => row.values["Group Number"] === "CA02483") ?? [];
    expect(lawRows.length).toBeGreaterThan(0);
    expect(lawRows.every((row) => row.group.groupId === 11)).toBe(true);
  });

  it("does not take over CaliforniaChoice or Choice Builder statements", () => {
    const california = [{ pageNumber: 1, text: californiaChoiceProductionShapeLines.join("\n"), lines: californiaChoiceProductionShapeLines }];
    const choiceBuilder = [{ pageNumber: 1, text: choiceBuilderStatementLines.join("\n"), lines: choiceBuilderStatementLines }];
    expect(looksLikeBeamStatement(california)).toBe(false);
    expect(interpretBeamStatement(california, [])).toBeNull();
    expect(looksLikeBeamStatement(choiceBuilder)).toBe(false);
    expect(interpretExtractedPdfPages(california, [])?.preview.pdf?.groupMatchStrategy).toBe("carrier_group_identity");
    expect(interpretExtractedPdfPages(choiceBuilder, [])?.preview.rowCount).toBeGreaterThan(0);
  });

  it("detects a generic parser misread that promoted CA##### into group names", () => {
    expect(previewLooksLikeMisreadBeam({
      unmatchedGroups: [{ sourceName: "CA02483", sourceNumber: null, rowCount: 1 }],
      sheets: [],
    })).toBe(true);
    expect(previewLooksLikeMisreadBeam({
      unmatchedGroups: [{ sourceName: "Example Law", sourceNumber: "CA02483", rowCount: 1 }],
      sheets: [],
    })).toBe(false);
  });
});
