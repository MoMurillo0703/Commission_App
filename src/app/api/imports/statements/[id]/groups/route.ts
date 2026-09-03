import { NextResponse } from "next/server";
import { confirmImportGroups, reviewImportGroups } from "@/data/importGroups";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { importGroupConfirmSchema, importMappingSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = importMappingSchema.parse(await request.json());
    return NextResponse.json(await reviewImportGroups(await getDb(), id, body.columnMapping));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = importGroupConfirmSchema.parse(await request.json());
    return NextResponse.json(await confirmImportGroups(await getDb(), id, body.columnMapping, body.decisions));
  } catch (error) {
    return toErrorResponse(error);
  }
}
