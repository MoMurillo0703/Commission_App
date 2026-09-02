import { NextResponse } from "next/server";
import { createCarrier, listCarriers } from "@/data/carriers";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { nameInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listCarriers());
}

export async function POST(request: Request) {
  try {
    const body = nameInputSchema.parse(await request.json());
    return NextResponse.json(await createCarrier(await getDb(), body), { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
