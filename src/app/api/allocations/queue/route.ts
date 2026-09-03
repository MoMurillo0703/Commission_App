import { NextResponse } from "next/server";
import { listCompensationQueue } from "@/data/compensationQueue";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listCompensationQueue());
  } catch (error) {
    return toErrorResponse(error);
  }
}
