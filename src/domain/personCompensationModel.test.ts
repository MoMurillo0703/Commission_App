import { describe, expect, it } from "vitest";
import { persistPeopleSplit, peopleFacingRecipients, peopleFacingSummary, peopleCompensationOptions } from "./personCompensationModel";

const mo = { personKind: "agent" as const, personId: 2 };
const john = { personKind: "agent" as const, personId: 1 };
const laura = { personKind: "account_manager" as const, personId: 3 };
const nancy = { personKind: "account_manager" as const, personId: 4 };

const names = {
  personName: (kind: "agent" | "account_manager", id: number) => {
    if (kind === "agent" && id === 1) return "John";
    if (kind === "agent" && id === 2) return "Mo Murillo";
    if (kind === "account_manager" && id === 3) return "Laura";
    if (kind === "account_manager" && id === 4) return "Nancy";
    return "Person";
  },
};

describe("person-centric compensation model", () => {
  it("writes Mo as one internal Agency entry and faces as Mo", () => {
    const entries = persistPeopleSplit({
      owner: mo,
      people: [
        { ...john, compensationBps: 7000 },
        { ...mo, compensationBps: 2000 },
        { ...laura, compensationBps: 500 },
        { ...nancy, compensationBps: 500 },
      ],
    });
    expect(entries.reduce((sum, entry) => sum + entry.compensationBps, 0)).toBe(10000);
    expect(entries.filter((entry) => entry.recipientType === "agency")).toEqual([
      { recipientType: "agency", compensationBps: 2000 },
    ]);
    expect(entries.some((entry) => entry.recipientType === "person" && entry.personId === mo.personId)).toBe(false);
    const facing = peopleFacingRecipients({
      entries,
      owner: mo,
      personName: names.personName,
    });
    expect(peopleFacingSummary(facing)).toBe("John 70% · Mo 20% · Laura 5% · Nancy 5%");
    expect(facing.some((row) => row.name === "Agency")).toBe(false);
  });

  it("rejects Mo Person plus Agency duplicate economics", () => {
    expect(() => persistPeopleSplit({
      owner: mo,
      people: [
        { ...mo, compensationBps: 5000 },
        { ...mo, compensationBps: 5000 },
      ],
    })).toThrow(/only once/);
    expect(() => peopleFacingRecipients({
      entries: [
        { recipientType: "agency", compensationBps: 5000 },
        { recipientType: "person", personKind: "agent", personId: 2, compensationBps: 5000 },
      ],
      owner: mo,
      personName: names.personName,
    })).toThrow(/Review is required/);
    expect(() => peopleFacingRecipients({
      entries: [
        { recipientType: "agency", compensationBps: 2000 },
        { recipientType: "team", teamId: 10, compensationBps: 8000 },
      ],
      owner: mo,
      personName: names.personName,
      teams: [{
        id: 10,
        members: [
          { personKind: "agent", personId: 1, name: "John", shareBps: 8000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
          { personKind: "agent", personId: 2, name: "Mo", shareBps: 2000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
        ],
      }],
      asOfMonth: "2026-08",
    })).toThrow(/Review is required/);
  });

  it("lists Mo as Mo, not Agency or Mo Agent", () => {
    const options = peopleCompensationOptions({
      agents: [{ id: 1, name: "John Elizondo" }, { id: 2, name: "Mo Murillo" }],
      accountManagers: [{ id: 3, name: "Laura Montoya" }],
      owner: mo,
    });
    expect(options.find((row) => row.personId === 2 && row.personKind === "agent")).toMatchObject({
      label: "Mo",
      agencyOwner: true,
    });
    expect(options.some((row) => row.label === "Agency")).toBe(false);
    expect(options.some((row) => row.label === "Mo Agent")).toBe(false);
  });
});
