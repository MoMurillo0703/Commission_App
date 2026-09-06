import { NextResponse } from "next/server";
import { confirmCompensationCorrection } from "@/data/compensationCorrections";
import { currentCorrectionInitiator } from "@/data/correctionInitiator";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { compensationCorrectionConfirmSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = compensationCorrectionConfirmSchema.parse(await request.json());
    return NextResponse.json(await confirmCompensationCorrection(await getDb(), {
      commissionIds: body.commissionIds,
      reason: body.reason,
      confirmationKey: body.confirmationKey,
      previewToken: body.previewToken,
      initiator: await currentCorrectionInitiator(),
    }), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
