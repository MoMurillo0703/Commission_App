import { NextResponse } from "next/server";
import { updateAgent } from "@/data/agents";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { parseOptionalPercent } from "@/lib/parse";
import { agentInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Agent not found." }, { status: 404 });
    const body = agentInputSchema.parse(await request.json());
    return NextResponse.json(
      await updateAgent(await getDb(), id, {
        name: body.name,
        defaultCompensationBps: parseOptionalPercent(body.defaultCompensationPercent),
        notes: body.notes,
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
