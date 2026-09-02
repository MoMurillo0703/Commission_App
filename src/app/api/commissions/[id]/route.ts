import { NextResponse } from "next/server";
import { updateCommission } from "@/data/commissions";
import { parseDollarsToCents } from "@/domain/money";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { parseOptionalDollars, parseOptionalPercent } from "@/lib/parse";
import { commissionInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Commission record not found." }, { status: 404 });
    const body = commissionInputSchema.parse(await request.json());
    return NextResponse.json(
      await updateCommission(await getDb(), id, {
        statementMonth: body.statementMonth,
        groupId: body.groupId,
        carrierId: body.carrierId,
        lineOfBusinessId: body.lineOfBusinessId,
        agentId: body.agentId ?? null,
        premiumCents: parseOptionalDollars(body.premium),
        grossCommissionCents: parseDollarsToCents(body.grossCommission),
        compensationBps: parseOptionalPercent(body.compensationPercent),
        sourceReference: body.sourceReference,
        notes: body.notes,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
