import { NextResponse } from "next/server";
import { createAgreement, filterAgreements, listAgreements } from "@/data/agreements";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { agreementInputSchema, emptyToNull } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupId = parseId(url.searchParams.get("groupId") ?? "");
  const agentId = parseId(url.searchParams.get("agentId") ?? "");
  return NextResponse.json(filterAgreements(await listAgreements(), {
    groupId: groupId ?? undefined,
    agentId: agentId ?? undefined,
  }));
}

export async function POST(request: Request) {
  try {
    const body = agreementInputSchema.parse(await request.json());
    return NextResponse.json(
      await createAgreement(await getDb(), {
        groupId: body.groupId,
        agentId: body.agentId,
        lineOfBusinessId: body.lineOfBusinessId,
        compensationBps: parsePercentToBps(body.compensationPercent),
        effectiveStart: body.effectiveStart,
        effectiveEnd: emptyToNull(body.effectiveEnd),
        status: body.status,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
