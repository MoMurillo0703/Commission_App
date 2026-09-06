import { describe, expect, it } from "vitest";
import {
  clearCoverageModes,
  coverageArrangementLabel,
  defaultCoverageModes,
  groupCoverageLines,
  selectNeedingSetupModes,
  setCoverageMode,
} from "./groupCoverage";

const lines = [
  { id: 1, name: "Medical" },
  { id: 2, name: "Dental" },
  { id: 3, name: "Vision" },
  { id: 4, name: "Life" },
];

const groupSplit = [
  { recipientType: "person", personKind: "agent", personId: 7, personName: "John Elizondo", teamName: null, compensationBps: 7000 },
  { recipientType: "person", personKind: "agent", personId: 8, personName: "Maurilio Murillo", teamName: null, compensationBps: 2000 },
  { recipientType: "person", personKind: "account_manager", personId: 9, personName: "Laura Montoya", teamName: null, compensationBps: 1000 },
];

describe("group coverage workspace", () => {
  it("shows every evidenced LOB with setup vs configured status and does not select configured lines by default", () => {
    const coverage = groupCoverageLines({
      groupId: 1,
      lines,
      evidence: lines.map((line) => ({ groupId: 1, lineOfBusinessId: line.id })),
      allocations: [{
        id: 40,
        groupId: 1,
        groupName: "ABC COMPANY",
        lineOfBusinessId: 4,
        lineOfBusinessName: "Life",
        effectiveStart: "2026-01",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", personName: null, teamName: null, compensationBps: 10000 }],
      }],
    });
    expect(coverage.map((line) => line.name)).toEqual(["Medical", "Dental", "Vision", "Life"]);
    expect(coverage.filter((line) => line.needsSetup).map((line) => line.name)).toEqual(["Medical", "Dental", "Vision"]);
    expect(coverage.find((line) => line.name === "Life")).toMatchObject({
      configured: true,
      agencyOnly: true,
    });
    expect(coverageArrangementLabel(coverage.find((line) => line.name === "Medical")!)).toBe("Needs setup");
    expect(coverageArrangementLabel(coverage.find((line) => line.name === "Life")!)).toBe("Agency 100%");
    expect(defaultCoverageModes(coverage)).toEqual({ 1: "template", 2: "template", 3: "template", 4: "skip" });
    expect(selectNeedingSetupModes(coverage)).toEqual(defaultCoverageModes(coverage));
    expect(clearCoverageModes(coverage)).toEqual({ 1: "skip", 2: "skip", 3: "skip", 4: "skip" });
  });

  it("labels a matching split as the Group split and a different split as an override", () => {
    const medical = {
      lineOfBusinessId: 1,
      name: "Medical",
      needsSetup: false,
      configured: true,
      agencyOnly: false,
      recipientSummary: "John Elizondo 70% · Maurilio Murillo 20% · Laura Montoya 10%",
      allocationId: 11,
      entries: groupSplit,
    };
    const vision = {
      ...medical,
      lineOfBusinessId: 3,
      name: "Vision",
      recipientSummary: "John Elizondo 50% · Agency 50%",
      allocationId: 13,
      entries: [
        { recipientType: "person", personKind: "agent", personId: 7, personName: "John Elizondo", teamName: null, compensationBps: 5000 },
        { recipientType: "agency", personName: null, teamName: null, compensationBps: 5000 },
      ],
    };
    expect(coverageArrangementLabel(medical, groupSplit)).toBe("Uses Group split");
    expect(coverageArrangementLabel(vision, groupSplit)).toBe("Override — John Elizondo 50% · Agency 50%");
    expect(setCoverageMode({ 1: "skip" }, 1, "template")).toEqual({ 1: "template" });
  });
});
