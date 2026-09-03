import { NextResponse } from "next/server";
import { saveStatementLayoutFromImport } from "@/data/statementLayouts";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { columnMappingSchema, statementLayoutSaveSchema } from "@/lib/validation";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  columnMapping: columnMappingSchema,
  name: statementLayoutSaveSchema.shape.name,
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = bodySchema.parse(await request.json());
    return NextResponse.json(await saveStatementLayoutFromImport(await getDb(), id, body.columnMapping, body.name));
  } catch (error) {
    return toErrorResponse(error);
  }
}
