import { NextResponse } from "next/server";
import { createAllocationsForLines } from "@/data/allocations";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { bulkAllocationInputSchema, emptyToNull } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = bulkAllocationInputSchema.parse(await request.json());
    return NextResponse.json(
      await createAllocationsForLines(await getDb(), {
        groupId: body.groupId,
        effectiveStart: body.effectiveStart,
        effectiveEnd: emptyToNull(body.effectiveEnd),
        status: body.status,
        targets: body.targets.map((target) => ({
          lineOfBusinessId: target.lineOfBusinessId,
          entries: target.entries.map((entry) => ({
            recipientType: entry.recipientType,
            personKind: entry.personKind ?? null,
            personId: entry.personId ?? null,
            teamId: entry.teamId ?? null,
            compensationBps: parsePercentToBps(entry.compensationPercent),
          })),
        })),
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
