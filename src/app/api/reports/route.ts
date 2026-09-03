import { NextResponse } from "next/server";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "@/data/reports";
import { exportReportDocument } from "@/data/reportExport";
import {
  agencyReportDocument,
  individualReportDocument,
  teamReportDocument,
} from "@/domain/reportDocuments";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import type { ReportKind } from "@/domain/reports";

export const dynamic = "force-dynamic";

function filtersFrom(url: URL) {
  const kind = (url.searchParams.get("kind") ?? "agency") as ReportKind;
  return {
    kind: kind === "individual" || kind === "team" ? kind : "agency" as ReportKind,
    paidMonth: url.searchParams.get("paidMonth"),
    startMonth: url.searchParams.get("startMonth"),
    endMonth: url.searchParams.get("endMonth"),
    ytd: url.searchParams.get("ytd") === "1",
    groupId: parseId(url.searchParams.get("groupId") ?? ""),
    carrierId: parseId(url.searchParams.get("carrierId") ?? ""),
    lineOfBusinessId: parseId(url.searchParams.get("lineOfBusinessId") ?? ""),
    personKind: url.searchParams.get("personKind") === "account_manager" ? "account_manager" as const : url.searchParams.get("personKind") === "agent" ? "agent" as const : null,
    personId: parseId(url.searchParams.get("personId") ?? ""),
    teamId: parseId(url.searchParams.get("teamId") ?? ""),
    accountManagerId: parseId(url.searchParams.get("accountManagerId") ?? ""),
    primaryAgentId: parseId(url.searchParams.get("primaryAgentId") ?? ""),
  };
}

async function reportPayload(url: URL) {
  const db = await getDb();
  const filters = filtersFrom(url);
  if (filters.kind === "individual") {
    const report = await buildIndividualReport(db, filters);
    const document = individualReportDocument(report.rows, report.totals, report.filters, report.names, report.names.personName || "Recipient");
    return { ...report, document };
  }
  if (filters.kind === "team") {
    const report = await buildTeamReport(db, filters);
    const document = teamReportDocument(report.rows, report.totals, report.filters, report.names);
    return { ...report, document };
  }
  const report = await buildAgencyReport(db, filters);
  const document = agencyReportDocument(report.rows, report.totals, report.filters, report.names);
  return { ...report, document };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const payload = await reportPayload(url);
    const format = url.searchParams.get("format");
    if (format === "csv" || format === "xlsx" || format === "pdf" || format === "print") {
      const exported = await exportReportDocument(payload.document, format);
      const body = typeof exported.body === "string" ? exported.body : new Uint8Array(exported.body);
      return new NextResponse(body, {
        headers: {
          "Content-Type": exported.contentType,
          "Content-Disposition": `${format === "print" || format === "pdf" ? "inline" : "attachment"}; filename="${exported.filename}"`,
        },
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}
