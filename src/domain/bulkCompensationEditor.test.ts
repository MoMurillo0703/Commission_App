import { describe, expect, it } from "vitest";
import { bulkCompensationPreviewSchema } from "@/lib/validation";
import {
  buildBulkCompensationRequestBody,
  bulkCompensationCommitBody,
  bulkCompensationCommitReady,
  bulkCompensationPreviewBlockReason,
  directorySelectionAfterReload,
  type BulkCompensationEditorState,
} from "./bulkCompensationEditor";

const septemberCustom: BulkCompensationEditorState = {
  effectiveStart: "2026-09",
  mode: "custom",
  teamId: "",
  people: [{ personKind: "agent", personId: "1", percent: "100" }],
  targets: [{ groupId: 12, lineOfBusinessId: 3 }],
};

describe("compensation editor Preview / Commit request wiring", () => {
  it("reproduces the production Preview failure: empty live targets after directory reload", () => {
    const selectedBeforeReload = ["12:medical"];
    const liveAfterOwnerMonthReload = directorySelectionAfterReload({
      editorOpen: false,
      selectedKeys: selectedBeforeReload,
      nextKeys: [],
    });
    expect(liveAfterOwnerMonthReload).toEqual([]);
    const broken = bulkCompensationPreviewBlockReason({
      ...septemberCustom,
      targets: liveAfterOwnerMonthReload.map(() => ({ groupId: 12, lineOfBusinessId: 3 })),
    });
    expect(broken).toBe("Select at least one Group and Line of Coverage.");
    expect(() => bulkCompensationPreviewSchema.parse(buildBulkCompensationRequestBody({
      ...septemberCustom,
      targets: [],
    }))).toThrow(/Select at least one Group and Line of Coverage/);
  });

  it("keeps the in-editor selection when the owner/month directory reload returns a different key set", () => {
    expect(directorySelectionAfterReload({
      editorOpen: true,
      selectedKeys: ["12:medical"],
      nextKeys: [],
    })).toEqual(["12:medical"]);
  });

  it("does not coerce an empty template id to 0, which Zod rejects", () => {
    const body = buildBulkCompensationRequestBody({
      ...septemberCustom,
      mode: "template",
      teamId: "",
    });
    expect(body.teamId).toBeNull();
    expect(Number("")).toBe(0);
    expect(() => bulkCompensationPreviewSchema.parse({
      ...body,
      teamId: 0,
    })).toThrow();
    expect(bulkCompensationPreviewBlockReason({
      ...septemberCustom,
      mode: "template",
      teamId: "",
    })).toBe("Choose a compensation template.");
  });

  it("builds a schema-valid September custom 100% Preview request and enables Commit from the preview snapshot", () => {
    const request = buildBulkCompensationRequestBody(septemberCustom);
    expect(bulkCompensationPreviewBlockReason(septemberCustom)).toBeNull();
    expect(bulkCompensationPreviewSchema.parse(request)).toMatchObject({
      effectiveStart: "2026-09",
      mode: "custom",
      teamId: null,
      targets: [{ groupId: 12, lineOfBusinessId: 3 }],
    });
    const preview = { previewToken: "a".repeat(64), hasConflicts: false };
    expect(bulkCompensationCommitReady(preview, request)).toBe(true);
    const liveTargetsWiped = { ...septemberCustom, targets: [] };
    expect(bulkCompensationPreviewBlockReason(liveTargetsWiped)).toBe("Select at least one Group and Line of Coverage.");
    expect(bulkCompensationCommitReady(preview, request)).toBe(true);
    expect(bulkCompensationCommitBody(request, preview.previewToken)).toEqual({
      ...request,
      previewToken: preview.previewToken,
    });
  });

  it("blocks invalid totals, missing people, conflicts, and missing preview tokens", () => {
    expect(bulkCompensationPreviewBlockReason({
      ...septemberCustom,
      people: [{ personKind: "agent", personId: "1", percent: "70" }],
    })).toBe("Compensation split must total 100%.");
    expect(bulkCompensationPreviewBlockReason({
      ...septemberCustom,
      people: [{ personKind: "agent", personId: "", percent: "100" }],
    })).toBe("Select each person in the split.");
    expect(bulkCompensationCommitReady({ previewToken: "a".repeat(64), hasConflicts: true }, buildBulkCompensationRequestBody(septemberCustom))).toBe(false);
    expect(bulkCompensationCommitReady(null, buildBulkCompensationRequestBody(septemberCustom))).toBe(false);
    expect(bulkCompensationCommitReady({ previewToken: "", hasConflicts: false }, buildBulkCompensationRequestBody(septemberCustom))).toBe(false);
  });
});
