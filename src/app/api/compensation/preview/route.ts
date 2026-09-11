import { NextResponse } from "next/server";
import { previewBulkCompensation } from "@/data/bulkCompensation";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { bulkCompensationPreviewSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = bulkCompensationPreviewSchema.parse(await request.json());
    return NextResponse.json(await previewBulkCompensation(await getDb(), {
      effectiveStart: body.effectiveStart,
      mode: body.mode,
      teamId: body.teamId,
      people: body.people?.map((person) => ({
        personKind: person.personKind,
        personId: person.personId,
        compensationBps: parsePercentToBps(person.compensationPercent),
      })),
      targets: body.targets,
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
