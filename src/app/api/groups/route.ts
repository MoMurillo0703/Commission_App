import { NextResponse } from "next/server";
import { createGroup, listGroups } from "@/data/groups";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { parseOptionalPercent } from "@/lib/parse";
import { groupInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listGroups());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = groupInputSchema.parse(await request.json());
    return NextResponse.json(
      await createGroup(await getDb(), {
        ...body,
        defaultCompensationBps: parseOptionalPercent(body.defaultCompensationPercent),
      }),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
