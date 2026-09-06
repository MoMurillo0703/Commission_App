import { NextResponse } from "next/server";
import { listGroupCompensationQueue } from "@/data/compensationQueue";
import { toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listGroupCompensationQueue());
  } catch (error) {
    return toErrorResponse(error);
  }
}
