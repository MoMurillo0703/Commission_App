import { NextResponse } from "next/server";
import { commitBulkCompensation } from "@/data/bulkCompensation";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { bulkCompensationCommitSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = bulkCompensationCommitSchema.parse(await request.json());
    return NextResponse.json(await commitBulkCompensation(await getDb(), {
      effectiveStart: body.effectiveStart,
      mode: body.mode,
      teamId: body.teamId,
      people: body.people?.map((person) => ({
        personKind: person.personKind,
        personId: person.personId,
        compensationBps: parsePercentToBps(person.compensationPercent),
      })),
      targets: body.targets,
      previewToken: body.previewToken,
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
