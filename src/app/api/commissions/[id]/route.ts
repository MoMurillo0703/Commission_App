import { NextResponse } from "next/server";
import { updateCommission, type CommissionPatch } from "@/data/commissions";
import { parseDollarsToCents } from "@/domain/money";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { parseOptionalDollars, parseOptionalPercent } from "@/lib/parse";
import { commissionPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Commission record not found." }, { status: 404 });
    const raw = await request.json();
    const body = commissionPatchSchema.parse(raw);
    const patch: CommissionPatch = {};
    if ("statementMonth" in raw) patch.statementMonth = body.statementMonth;
    if ("groupId" in raw) patch.groupId = body.groupId;
    if ("carrierId" in raw) patch.carrierId = body.carrierId;
    if ("lineOfBusinessId" in raw) patch.lineOfBusinessId = body.lineOfBusinessId;
    if ("agentId" in raw) patch.agentId = body.agentId ?? null;
    if ("premium" in raw) patch.premiumCents = parseOptionalDollars(body.premium);
    if ("grossCommission" in raw) patch.grossCommissionCents = parseDollarsToCents(body.grossCommission ?? "");
    if ("compensationPercent" in raw) patch.compensationBps = parseOptionalPercent(body.compensationPercent);
    if ("sourceReference" in raw) patch.sourceReference = body.sourceReference;
    if ("notes" in raw) patch.notes = body.notes;
    if ("premiumMonth" in raw) patch.premiumMonth = body.premiumMonth;
    if ("importStatementId" in raw) patch.importStatementId = body.importStatementId ?? null;
    if ("sourceRowKey" in raw) patch.sourceRowKey = body.sourceRowKey;
    if ("sourceCoverageLabel" in raw) patch.sourceCoverageLabel = body.sourceCoverageLabel;
    if ("sourceGroupLabel" in raw) patch.sourceGroupLabel = body.sourceGroupLabel;
    if ("sourceLobLabel" in raw) patch.sourceLobLabel = body.sourceLobLabel;
    if ("sourcePeriodLabel" in raw) patch.sourcePeriodLabel = body.sourcePeriodLabel;
    return NextResponse.json(await updateCommission(await getDb(), id, patch));
  } catch (error) {
    return toErrorResponse(error);
  }
}
