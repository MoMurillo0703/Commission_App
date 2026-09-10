import { NextResponse } from "next/server";
import { createCommission, listCommissions } from "@/data/commissions";
import { paidMonthPattern } from "@/domain/dates";
import { parseDollarsToCents } from "@/domain/money";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { parseOptionalDollars, parseOptionalPercent } from "@/lib/parse";
import { commissionInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const paidMonth = new URL(request.url).searchParams.get("paidMonth")?.trim() ?? "";
  return NextResponse.json(
    await listCommissions(undefined, paidMonthPattern.test(paidMonth) ? { paidMonth } : undefined),
  );
}

export async function POST(request: Request) {
  try {
    const body = commissionInputSchema.parse(await request.json());
    return NextResponse.json(
      await createCommission(await getDb(), {
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
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
