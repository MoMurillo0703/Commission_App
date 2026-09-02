import { NextResponse } from "next/server";
import { updateAgreement } from "@/data/agreements";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { agreementPatchSchema, emptyToNull } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Compensation agreement not found." }, { status: 404 });
    const body = agreementPatchSchema.parse(await request.json());
    return NextResponse.json(
      await updateAgreement(await getDb(), id, {
        status: body.status,
        effectiveEnd: body.effectiveEnd === undefined ? undefined : emptyToNull(body.effectiveEnd),
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
