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
  compensationPercent: z.string().nullable().optional(),
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

export function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
