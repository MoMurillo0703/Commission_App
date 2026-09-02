import { NextResponse } from "next/server";
import { createAgent, listAgents } from "@/data/agents";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { parseOptionalPercent } from "@/lib/parse";
import { agentInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listAgents());
}

export async function POST(request: Request) {
  try {
    const body = agentInputSchema.parse(await request.json());
    return NextResponse.json(
      await createAgent(await getDb(), {
        name: body.name,
        defaultCompensationBps: parseOptionalPercent(body.defaultCompensationPercent),
        notes: body.notes,
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
