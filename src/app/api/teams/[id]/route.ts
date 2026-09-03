import { NextResponse } from "next/server";
import { replaceTeamMembers, updateTeam } from "@/data/teams";
import { parsePercentToBps } from "@/domain/money";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { emptyToNull, teamPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Team not found." }, { status: 404 });
    const body = teamPatchSchema.parse(await request.json());
    const db = await getDb();
    let team = await updateTeam(db, id, { name: body.name, status: body.status });
    if (body.members) {
      team = await replaceTeamMembers(db, id, body.members.map((member) => ({
        personKind: member.personKind,
        personId: member.personId,
        shareBps: parsePercentToBps(member.compensationPercent),
        effectiveStart: member.effectiveStart,
        effectiveEnd: emptyToNull(member.effectiveEnd),
        status: member.status,
      })));
    }
    return NextResponse.json(team);
  } catch (error) {
    return toErrorResponse(error);
  }
}
