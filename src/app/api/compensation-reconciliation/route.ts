import { NextResponse } from "next/server";
import { buildMonthlyCompensationReconciliation } from "@/data/businessCompensation";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { isPaidMonth } from "@/domain/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const paidMonth = new URL(request.url).searchParams.get("paidMonth") ?? "";
    if (!isPaidMonth(paidMonth)) {
      return NextResponse.json({ message: "Choose a paid month." }, { status: 400 });
    }
    return NextResponse.json(await buildMonthlyCompensationReconciliation(await getDb(), paidMonth));
  } catch (error) {
    return toErrorResponse(error);
  }
}
