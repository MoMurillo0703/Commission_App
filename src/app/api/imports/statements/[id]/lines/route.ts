import { NextResponse } from "next/server";
import { confirmImportLines } from "@/data/importNamed";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { importNamedConfirmSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = importNamedConfirmSchema.parse(await request.json());
    return NextResponse.json(await confirmImportLines(await getDb(), id, body.columnMapping, body.decisions));
  } catch (error) {
    return toErrorResponse(error);
  }
}
