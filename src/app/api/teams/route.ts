import { NextResponse } from "next/server";
import { createTeam, listTeams } from "@/data/teams";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { emptyToNull, teamInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listTeams());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = teamInputSchema.parse(await request.json());
    return NextResponse.json(
      await createTeam(await getDb(), {
        name: body.name,
        status: body.status,
        members: body.members?.map((member) => ({
          personKind: member.personKind,
          personId: member.personId,
          shareBps: parsePercentToBps(member.compensationPercent),
          effectiveStart: member.effectiveStart,
          effectiveEnd: emptyToNull(member.effectiveEnd),
          status: member.status,
        })),
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
