import { NextResponse } from "next/server";
import { updateGroup } from "@/data/groups";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { parseOptionalPercent } from "@/lib/parse";
import { groupInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Group not found." }, { status: 404 });
    const body = groupInputSchema.parse(await request.json());
    return NextResponse.json(
      await updateGroup(await getDb(), id, {
        ...body,
        defaultCompensationBps: parseOptionalPercent(body.defaultCompensationPercent),
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
