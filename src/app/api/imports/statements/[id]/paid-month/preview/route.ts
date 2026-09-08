import { NextResponse } from "next/server";
import { previewStatementPaidMonthChange } from "@/data/statementPaidMonthChange";
import { currentCorrectionInitiator } from "@/data/correctionInitiator";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { statementPaidMonthPreviewSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await currentCorrectionInitiator();
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = statementPaidMonthPreviewSchema.parse(await request.json());
    return NextResponse.json(await previewStatementPaidMonthChange(await getDb(), id, body.newPaidMonth));
  } catch (error) {
    return toErrorResponse(error);
  }
}
