import { NextResponse } from "next/server";
import { resolveStatementCarrier } from "@/data/carriers";
import { listGroups } from "@/data/groups";
import { createImportStatement } from "@/data/statements";
import { paidMonthPattern } from "@/domain/dates";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { inspectWorkbook, previewWorkbook } from "@/domain/workbook";
import { getDb } from "@/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseId, toErrorResponse } from "@/lib/http";
import { emptyToNull } from "@/lib/validation";

const allowed = new Set(["application/pdf", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("statement");
  if (!(file instanceof File)) return NextResponse.json({ message: "Choose a statement file." }, { status: 400 });
  if (!allowed.has(file.type) && !/\.(pdf|xls|xlsx)$/i.test(file.name)) {
    return NextResponse.json({ message: "Only PDF and Excel statements are supported." }, { status: 415 });
  }

  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    return NextResponse.json({
      fileName: file.name,
      fileType: "pdf",
      status: "needs_profile",
      message: "PDF accepted. Select or create a carrier extraction profile before posting any rows.",
    });
  }

  const paidMonthValue = String(form.get("paidMonth") ?? "").trim();
  const persist = Boolean(paidMonthValue);
  if (persist && !paidMonthPattern.test(paidMonthValue)) {
    return NextResponse.json({ message: "Enter a paid month as YYYY-MM." }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    if (!persist) {
      const sheets = await inspectWorkbook(buffer);
      return NextResponse.json({
        fileName: file.name,
        fileType: "excel",
        status: "ready_to_map",
        sheets,
        message: "Workbook inspected. Confirm the carrier and map its columns before importing.",
      });
    }

    const db = await getDb();
    const resolved = await resolveStatementCarrier(db, {
      carrierId: parseId(String(form.get("carrierId") ?? "")),
      carrierName: emptyToNull(String(form.get("carrierName") ?? "")),
    });
    const preview = await previewWorkbook(buffer, await listGroups(db));
    const statement = await createImportStatement(db, {
      originalFilename: file.name,
      paidMonth: paidMonthValue,
      carrierId: resolved.carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
      fileBuffer: new Uint8Array(buffer),
    });

    return NextResponse.json({
      fileName: file.name,
      fileType: "excel",
      status: "ready_to_map",
      sheets: preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers })),
      preview,
      statement,
      carrierCreated: resolved.created,
      message: resolved.created
        ? `Saved to ${paidMonthValue} and created carrier ${resolved.carrier.name}. Review unmatched groups before posting any rows.`
        : `Saved to ${paidMonthValue} for ${resolved.carrier.name}. Review unmatched groups before posting any rows.`,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError || error instanceof NotFoundError) return toErrorResponse(error);
    return NextResponse.json({ message: "The workbook could not be read. Confirm that it is a valid .xlsx file." }, { status: 422 });
  }
}
