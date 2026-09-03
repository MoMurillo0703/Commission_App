import { NextResponse } from "next/server";
import { confirmPdfStatementLayout } from "@/data/pdfLayoutConfirm";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { pdfLayoutSelectionSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = pdfLayoutSelectionSchema.parse(await request.json());
    return NextResponse.json(await confirmPdfStatementLayout(await getDb(), id, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
