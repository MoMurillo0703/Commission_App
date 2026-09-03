import { NextResponse } from "next/server";
import { bulkAssignGroups } from "@/data/groups";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";
import { bulkGroupAssignmentSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  try {
    const body = bulkGroupAssignmentSchema.parse(await request.json());
    return NextResponse.json(await bulkAssignGroups(await getDb(), body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
