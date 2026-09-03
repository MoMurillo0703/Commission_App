import { NextResponse } from "next/server";
import { inspectStatementUpload } from "@/data/inspectStatement";
import { getDb } from "@/db";
import { toErrorResponse } from "@/lib/http";

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("statement");
  if (!(file instanceof File)) return NextResponse.json({ message: "Choose a statement file." }, { status: 400 });
  const paidMonth = String(form.get("paidMonth") ?? "").trim();

  try {
    const result = await inspectStatementUpload({
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      buffer: await file.arrayBuffer(),
      paidMonth,
      carrierId: String(form.get("carrierId") ?? ""),
      carrierName: String(form.get("carrierName") ?? ""),
      persist: Boolean(paidMonth),
    }, paidMonth ? await getDb() : undefined);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
