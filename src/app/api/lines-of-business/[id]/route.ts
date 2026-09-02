import { NextResponse } from "next/server";
import { updateLineOfBusiness } from "@/data/linesOfBusiness";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { nameInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Line of business not found." }, { status: 404 });
    const body = nameInputSchema.parse(await request.json());
    return NextResponse.json(await updateLineOfBusiness(await getDb(), id, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
