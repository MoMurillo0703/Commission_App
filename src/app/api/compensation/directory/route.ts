import { NextResponse } from "next/server";
import { loadCompensationDirectory, parseCompensationDirectoryFilters } from "@/data/compensationDirectory";
import { getDb } from "@/db";
import { currentPaidMonth, isPaidMonth } from "@/domain/dates";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const asOf = url.searchParams.get("asOfMonth") ?? "";
    const filters = parseCompensationDirectoryFilters(
      Object.fromEntries(url.searchParams.entries()),
      isPaidMonth(asOf) ? asOf : currentPaidMonth(),
    );
    return NextResponse.json(await loadCompensationDirectory(await getDb(), filters));
  } catch (error) {
    return toErrorResponse(error);
  }
}
