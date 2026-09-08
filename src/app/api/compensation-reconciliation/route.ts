import { NextResponse } from "next/server";
import { buildMonthlyCompensationReconciliation } from "@/data/businessCompensation";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { isPaidMonth } from "@/domain/dates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const paidMonth = url.searchParams.get("paidMonth") ?? "";
    if (!isPaidMonth(paidMonth)) {
      return NextResponse.json({ message: "Choose a paid month." }, { status: 400 });
    }
    return NextResponse.json(await buildMonthlyCompensationReconciliation(await getDb(), {
      paidMonth,
      groupId: parseId(url.searchParams.get("groupId") ?? ""),
      carrierId: parseId(url.searchParams.get("carrierId") ?? ""),
      lineOfBusinessId: parseId(url.searchParams.get("lineOfBusinessId") ?? ""),
    }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
