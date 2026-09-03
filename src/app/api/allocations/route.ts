import { NextResponse } from "next/server";
import { createAllocation, listAllocations } from "@/data/allocations";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { allocationInputSchema, emptyToNull } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const groupId = parseId(url.searchParams.get("groupId") ?? "");
  const rows = await listAllocations();
  return NextResponse.json(groupId ? rows.filter((row) => row.groupId === groupId) : rows);
}

export async function POST(request: Request) {
  try {
    const body = allocationInputSchema.parse(await request.json());
    return NextResponse.json(
      await createAllocation(await getDb(), {
        groupId: body.groupId,
        lineOfBusinessId: body.lineOfBusinessId,
        effectiveStart: body.effectiveStart,
        effectiveEnd: emptyToNull(body.effectiveEnd),
        status: body.status,
        entries: body.entries.map((entry) => ({
          recipientType: entry.recipientType,
          personKind: entry.personKind ?? null,
          personId: entry.personId ?? null,
          teamId: entry.teamId ?? null,
          compensationBps: parsePercentToBps(entry.compensationPercent),
        })),
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
