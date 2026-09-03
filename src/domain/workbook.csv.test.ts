import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { suggestColumnMapping } from "./columnMapping";
import { previewCsv } from "./workbook";

const anthemPath = path.join(process.cwd(), "tests/fixtures/anthem-08-2026.csv");

describe("CSV statement inspection", () => {
  it("detects an Anthem-style header after statement preamble rows", () => {
    const csv = [
      "Agency,,,,TOTAL PREMIUM RECEIVED THIS MONTH,,1000.00",
      "Address,,,,STATEMENT OF ACCOUNT",
      "City,,,,PERIOD ENDING :07/31/2026",
      "",
      "TRACKING CODE,PRODUCER NAME,PRODUCT TYPE,NAME / GROUP NAME,SPLIT % AMT,DUE DATE,PREMIUM RECEIVED,CURRENT COMMISSION,COMMENTS",
      ",Jane Agent,MED,Example Group,100.0,07/01/2026,793.86,79.38,REINSTATE",
    ].join("\n");
    const preview = previewCsv(new TextEncoder().encode(csv), []);
    const sheet = preview.sheets[0];
    const mapping = suggestColumnMapping(sheet.headers);

    expect(sheet.headerRowNumber).toBe(5);
    expect(sheet.rowCount).toBe(1);
    expect(mapping.groupName).toBe("NAME / GROUP NAME");
    expect(mapping.lineOfBusiness).toBe("PRODUCT TYPE");
    expect(mapping.grossCommission).toBe("CURRENT COMMISSION");
    expect(mapping.premium).toBe("PREMIUM RECEIVED");
    expect(mapping.premiumMonth).toBe("DUE DATE");
    expect(mapping.compensationPercent).toBeNull();
  });

  it("reads the sanitized Anthem August 2026 acceptance fixture", () => {
    const preview = previewCsv(fs.readFileSync(anthemPath), []);
    expect(preview.sheets[0].headerRowNumber).toBe(5);
    expect(preview.rowCount).toBeGreaterThan(0);
    expect(preview.sheets[0].headers).toContain("CURRENT COMMISSION");
    expect(preview.sheets[0].rows[0].values["NAME / GROUP NAME"]).toBeTruthy();
  });
});
