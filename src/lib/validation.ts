import { z } from "zod";
import { paidMonthPattern } from "@/domain/dates";

export const nameInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
});

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  groupNumber: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  accountManagerId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  primaryAgentId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  defaultCompensationPercent: z.string().optional().nullable(),
});

export const bulkGroupAssignmentSchema = z.object({
  groupIds: z.array(z.coerce.number().int().positive()).min(1, "Select at least one group."),
  accountManagerId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  primaryAgentId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
});

export const personKindSchema = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z.enum(["agent", "account_manager"], { error: "Choose Agent or Account Manager." }).nullable(),
);

export const allocationEntrySchema = z.object({
  recipientType: z.enum(["agency", "person", "team"]),
  personKind: personKindSchema.optional(),
  personId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  teamId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  compensationPercent: z.string().min(1, "Compensation split is required."),
});

export const allocationInputSchema = z.object({
  groupId: z.coerce.number().int().positive("Group is required."),
  lineOfBusinessId: z.coerce.number().int().positive("Line of business is required."),
  effectiveStart: z.string().regex(paidMonthPattern, "Enter an effective start month as YYYY-MM."),
  effectiveEnd: z.union([
    z.string().regex(paidMonthPattern, "Enter an effective end month as YYYY-MM."),
    z.literal(""),
    z.null(),
  ]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  entries: z.array(allocationEntrySchema).min(1, "Add at least one recipient."),
});

export const allocationPatchSchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
  effectiveEnd: z.union([
    z.string().regex(paidMonthPattern, "Enter an effective end month as YYYY-MM."),
    z.literal(""),
    z.null(),
  ]).optional(),
});

export const teamMemberInputSchema = z.object({
  personKind: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.enum(["agent", "account_manager"], { error: "Choose Agent or Account Manager." }),
  ),
  personId: z.coerce.number().int().positive(),
  compensationPercent: z.string().min(1, "Team member split is required."),
  effectiveStart: z.string().regex(paidMonthPattern, "Enter an effective start month as YYYY-MM."),
  effectiveEnd: z.union([
    z.string().regex(paidMonthPattern, "Enter an effective end month as YYYY-MM."),
    z.literal(""),
    z.null(),
  ]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Team name is required."),
  status: z.enum(["active", "inactive"]).optional(),
  members: z.array(teamMemberInputSchema).optional(),
});

export const teamPatchSchema = z.object({
  name: z.string().trim().min(1, "Team name is required.").optional(),
  status: z.enum(["active", "inactive"]).optional(),
  members: z.array(teamMemberInputSchema).optional(),
});

export const agentInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  defaultCompensationPercent: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const commissionInputSchema = z.object({
  statementMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter a statement month as YYYY-MM."),
  groupId: z.coerce.number().int().positive("Group is required."),
  carrierId: z.coerce.number().int().positive("Carrier is required."),
  lineOfBusinessId: z.coerce.number().int().positive("Line of business is required."),
  agentId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
  premium: z.string().optional().nullable(),
  grossCommission: z.string().min(1, "Gross commission is required."),
  compensationPercent: z.string().optional().nullable(),
  sourceReference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export const paidMonthSchema = z.string().regex(paidMonthPattern, "Enter a paid month as YYYY-MM.");

export const agreementInputSchema = z.object({
  groupId: z.coerce.number().int().positive("Group is required."),
  agentId: z.coerce.number().int().positive("Agent is required."),
  lineOfBusinessId: z.coerce.number().int().positive("Line of business is required."),
  compensationPercent: z.string().min(1, "Compensation split is required."),
  effectiveStart: z.string().regex(paidMonthPattern, "Enter an effective start month as YYYY-MM."),
  effectiveEnd: z.union([
    z.string().regex(paidMonthPattern, "Enter an effective end month as YYYY-MM."),
    z.literal(""),
    z.null(),
  ]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const agreementPatchSchema = z.object({
  status: z.enum(["active", "inactive"]).optional(),
  effectiveEnd: z.union([
    z.string().regex(paidMonthPattern, "Enter an effective end month as YYYY-MM."),
    z.literal(""),
    z.null(),
  ]).optional(),
});

export const statementNameSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required."),
});

export const columnMappingSchema = z.object({
  groupName: z.string().nullable().optional(),
  groupNumber: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  lineOfBusiness: z.string().nullable().optional(),
  agent: z.string().nullable().optional(),
  premium: z.string().nullable().optional(),
  grossCommission: z.string().nullable().optional(),
  premiumMonth: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const statementPatchSchema = z.object({
  displayName: z.string().trim().min(1, "Display name is required.").optional(),
  columnMapping: columnMappingSchema.optional(),
});

export const importMappingSchema = z.object({
  columnMapping: columnMappingSchema,
});

export const importGroupDecisionSchema = z.object({
  key: z.string().min(1),
  action: z.enum(["create", "match"]),
  existingGroupId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
});

export const importGroupConfirmSchema = z.object({
  columnMapping: columnMappingSchema,
  decisions: z.array(importGroupDecisionSchema).default([]),
});

export const importNamedDecisionSchema = z.object({
  key: z.string().min(1),
  action: z.enum(["create", "match"]),
  existingId: z.union([z.coerce.number().int().positive(), z.null()]).optional(),
});

export const importNamedConfirmSchema = z.object({
  columnMapping: columnMappingSchema,
  decisions: z.array(importNamedDecisionSchema).default([]),
});

export const statementLayoutSaveSchema = z.object({
  name: z.string().trim().min(1).optional(),
});

export const pdfLayoutSelectionSchema = z.object({
  headerPageNumber: z.coerce.number().int().positive(),
  headerLineNumber: z.coerce.number().int().positive(),
  dataStartPageNumber: z.coerce.number().int().positive(),
  dataStartLineNumber: z.coerce.number().int().positive(),
  dataEndPageNumber: z.coerce.number().int().positive(),
  dataEndLineNumber: z.coerce.number().int().positive(),
});

export function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
