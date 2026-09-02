import { NextResponse } from "next/server";
import { getImportStatement } from "@/data/statements";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import { readStatementFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = parseId((await context.params).id);
    if (!id) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    const statement = await getImportStatement(await getDb(), id);
    if (!statement) return NextResponse.json({ message: "Statement not found." }, { status: 404 });
    if (!statement.storedPath) return NextResponse.json({ message: "This statement has no stored original file." }, { status: 404 });

    const bytes = await readStatementFile(statement.storedPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${statement.originalFilename.replaceAll('"', "")}"`,
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
