import { NextResponse } from "next/server";
import { confirmStatementPaidMonthChange } from "@/data/statementPaidMonthChange";
import { currentCorrectionInitiator } from "@/data/correctionInitiator";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { statementPaidMonthConfirmSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const body = statementPaidMonthConfirmSchema.parse(await request.json());
    return NextResponse.json(await confirmStatementPaidMonthChange(await getDb(), {
      statementId: id,
      newPaidMonth: body.newPaidMonth,
      reason: body.reason,
      confirmationKey: body.confirmationKey,
      previewToken: body.previewToken,
      initiator: await currentCorrectionInitiator(),
    }), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
