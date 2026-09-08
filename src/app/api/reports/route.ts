import { NextResponse } from "next/server";
import { buildAgencyOwnerReport } from "@/data/businessCompensation";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "@/data/reports";
import { exportReportDocument } from "@/data/reportExport";
import {
  agencyReportDocument,
  individualReportDocument,
  teamReportDocument,
} from "@/domain/reportDocuments";
import { reportEmptyMessage } from "@/domain/reportDiscovery";
import { recipientReportReviewState } from "@/domain/recipientStatement";
import { getDb } from "@/db";
import { parseId, toErrorResponse } from "@/lib/http";
import type { ReportKind } from "@/domain/reports";
import { formatCents } from "@/domain/money";

export const dynamic = "force-dynamic";

function filtersFrom(url: URL) {
  const kind = (url.searchParams.get("kind") ?? "agency") as ReportKind;
  return {
    kind: kind === "individual" || kind === "team" || kind === "recipient" ? kind : "agency" as ReportKind,
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
  if (url.searchParams.get("personKind") === "agency_owner") {
    const paidMonth = filters.paidMonth ?? "";
    const report = await buildAgencyOwnerReport(db, paidMonth);
    return {
      filters: { ...filters, kind: "individual" as const },
      names: { personName: report.ownerLabel },
      rows: report.rows,
      totals: { compensationCents: report.totals.compensationCents, grossCommissionCents: report.totals.grossCents, premiumCents: 0, compensationDistributedCents: 0, agencyNetCents: 0 },
      document: {
        agencyName: "Murillo Insurance",
        title: `${report.ownerLabel} Commission Report`,
        period: paidMonth,
        filtersUsed: [`Period: ${paidMonth || "All"}`, `Recipient: ${report.ownerLabel}`],
        generatedAt: new Date().toISOString(),
        totals: [
          { label: "MO / AGENCY", value: formatCents(report.totals.compensationCents) },
          { label: "UNRESOLVED / FALLBACK", value: formatCents(report.totals.fallbackAgencyCents + report.totals.unresolvedCents) },
        ],
        headers: ["Group", "Carrier", "Coverage", "Recipient", "Amount"],
        rows: report.rows.map((row) => [row.groupName, row.carrierName, row.lineOfBusinessName, row.recipientName, formatCents(row.compensationCents)]),
        notes: report.ownerConfigured
          ? ["Fallback Agency 100% settlements are listed separately and are not treated as intentional Mo compensation."]
          : ["Agency owner identity is not configured. Combined Mo / Agency totals need a durable owner person ID."],
      },
      emptyMessage: report.ownerConfigured ? null : "Agency owner identity is not configured.",
      payable: {
        payableReady: report.totals.unresolvedCents === 0 && report.totals.fallbackAgencyCents === 0,
        message: report.totals.fallbackAgencyCents || report.totals.unresolvedCents
          ? "Unresolved or fallback Agency amounts are excluded from Mo / Agency compensation."
          : null,
      },
      reconciliation: report.reconciliation,
      drilldown: report.drilldown,
    };
  }
  if (filters.kind === "individual" || filters.kind === "recipient") {
    const report = await buildIndividualReport(db, filters);
    const review = recipientReportReviewState({
      personSelected: Boolean(filters.personId && filters.personKind),
      personName: report.names.personName ?? null,
      payoutRowCount: report.rows.length,
      payableCents: report.totals.compensationCents,
      postedCommissionCount: report.availability.postedCommissionCount,
      matchingCommissionCount: report.matchingCommissionCount,
      unallocatedCount: report.payable.unallocated.length,
    });
    const recipientName = report.names.personName || (filters.personId ? "Unknown person" : "All people");
    const document = individualReportDocument(report.rows, report.totals, report.filters, report.names, recipientName);
    const focusedRecipient = filters.kind === "recipient" || Boolean(filters.personId);
    return {
      ...report,
      document: !focusedRecipient || review.showPayableTotals ? document : { ...document, totals: [] },
      emptyMessage: focusedRecipient ? review.emptyMessage : reportEmptyMessage(report.filters, report.availability),
      review: review.kind,
    };
  }
  if (filters.kind === "team") {
    const report = await buildTeamReport(db, filters);
    const document = teamReportDocument(report.rows, report.totals, report.filters, report.names);
    return { ...report, document, emptyMessage: reportEmptyMessage(report.filters, report.availability) };
  }
  const report = await buildAgencyReport(db, filters);
  const document = agencyReportDocument(report.rows, report.totals, report.filters, report.names);
  return { ...report, document, emptyMessage: reportEmptyMessage(report.filters, report.availability) };
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
          "Content-Disposition": `${format === "print" ? "inline" : "attachment"}; filename="${exported.filename}"`,
        },
      });
    }
    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}
