import { NextResponse } from "next/server";
import { previewCompensationCorrection } from "@/data/compensationCorrections";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { compensationCorrectionPreviewSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = compensationCorrectionPreviewSchema.parse(await request.json());
    return NextResponse.json(await previewCompensationCorrection(await getDb(), body.commissionIds));
  } catch (error) {
    return toErrorResponse(error);
  }
}
