import { NextResponse } from "next/server";
import { updateAllocation } from "@/data/allocations";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { allocationPatchSchema, emptyToNull } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Compensation allocation not found." }, { status: 404 });
    const body = allocationPatchSchema.parse(await request.json());
    return NextResponse.json(await updateAllocation(await getDb(), id, {
      status: body.status,
      effectiveEnd: body.effectiveEnd === undefined ? undefined : emptyToNull(body.effectiveEnd),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
