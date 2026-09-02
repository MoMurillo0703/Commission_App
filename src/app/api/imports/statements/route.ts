import { NextResponse } from "next/server";
import { listImportStatements } from "@/data/statements";
import { toErrorResponse } from "@/lib/http";
import { paidMonthSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const paidMonth = paidMonthSchema.parse(new URL(request.url).searchParams.get("paidMonth") ?? "");
    return NextResponse.json(await listImportStatements(paidMonth));
  } catch (error) {
    return toErrorResponse(error);
  }
}
