import { describe, expect, it } from "vitest";
import {
  applyNamedResolutions,
  collectUnmatchedNamedImports,
  resolveNamedImport,
  unmatchedNamedIdentity,
} from "./namedImport";

describe("named import resolution", () => {
  it("matches conservatively and does not merge ambiguous names", () => {
    const records = [
      { id: 1, name: "Dental" },
      { id: 2, name: "dental" },
    ];
    expect(resolveNamedImport(records, "Dental").status).toBe("ambiguous");
    expect(resolveNamedImport([{ id: 1, name: "Dental" }], "Vision").status).toBe("unmatched");
    expect(unmatchedNamedIdentity("  PPO  Dental ")).toBe("name:ppo dental");
  });

  it("applies a saved resolution without inferring a new record", () => {
    const match = resolveNamedImport([{ id: 1, name: "Dental" }], "PPO Dental");
    expect(match.status).toBe("unmatched");
    const resolved = applyNamedResolutions(
      match,
      [{ key: "name:ppo dental", entityId: 9, sourceName: "PPO Dental", action: "create" }],
      [{ id: 9, name: "PPO Dental" }],
    );
    expect(resolved).toMatchObject({ status: "matched", id: 9, name: "PPO Dental", source: "PPO Dental" });
  });

  it("collects unmatched names from row exceptions", () => {
    const unmatched = collectUnmatchedNamedImports([
      { exceptions: ["Unmatched line of business: PPO Dental."], importedName: "PPO Dental" },
      { exceptions: ["Unmatched line of business: PPO Dental."], importedName: "PPO Dental" },
      { exceptions: ["Line of business matches more than one record: MED."], importedName: "MED" },
      { exceptions: ["Gross commission is missing."], importedName: "Ignored" },
    ], ["Unmatched line of business:", "Line of business matches more than one"]);
    expect(unmatched).toEqual([
      { key: "name:med", sourceName: "MED", rowCount: 1 },
      { key: "name:ppo dental", sourceName: "PPO Dental", rowCount: 2 },
    ]);
  });
});
