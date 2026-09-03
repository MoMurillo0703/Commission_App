import { NextResponse } from "next/server";
import { deleteImportStatement, getImportStatement, renameImportStatement, saveImportColumnMapping } from "@/data/statements";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { statementPatchSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const row = await getImportStatement(await getDb(), id);
    if (!row) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    return NextResponse.json(row);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = statementPatchSchema.parse(await request.json());
    if (body.displayName) return NextResponse.json(await renameImportStatement(await getDb(), id, body.displayName));
    if (body.columnMapping) return NextResponse.json(await saveImportColumnMapping(await getDb(), id, body.columnMapping));
    return NextResponse.json({ message: "Nothing to update." }, { status: 400 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    return NextResponse.json(await deleteImportStatement(await getDb(), id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
