import { NextResponse } from "next/server";
import { createLineOfBusiness, listLinesOfBusiness } from "@/data/linesOfBusiness";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { nameInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await listLinesOfBusiness());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = nameInputSchema.parse(await request.json());
    return NextResponse.json(await createLineOfBusiness(await getDb(), body), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
