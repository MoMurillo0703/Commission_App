import { NextResponse } from "next/server";
import { postImportStatement } from "@/data/importPosting";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { importMappingSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = importMappingSchema.parse(await request.json());
    return NextResponse.json(await postImportStatement(await getDb(), id, body.columnMapping));
  } catch (error) {
    return toErrorResponse(error);
  }
}
