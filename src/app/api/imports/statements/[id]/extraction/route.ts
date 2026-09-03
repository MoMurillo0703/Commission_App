import { NextResponse } from "next/server";
import { getStatementExtraction } from "@/data/pdfLayoutConfirm";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    return NextResponse.json(await getStatementExtraction(await getDb(), id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
