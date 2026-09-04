import { relations } from "drizzle-orm";
import { integer, pgTable, text } from "drizzle-orm/pg-core";

export const carriers = pgTable("carriers", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const linesOfBusiness = pgTable("lines_of_business", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const accountManagers = pgTable("account_managers", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agents = pgTable("agents", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  defaultCompensationBps: integer("default_compensation_bps"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const groups = pgTable("groups", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  groupNumber: text("group_number"),
  notes: text("notes"),
  accountManagerId: integer("account_manager_id").references(() => accountManagers.id),
  primaryAgentId: integer("primary_agent_id").references(() => agents.id),
  defaultCompensationBps: integer("default_compensation_bps"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const carrierCoverageAliases = pgTable("carrier_coverage_aliases", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  carrierId: integer("carrier_id").notNull().references(() => carriers.id),
  sourceValue: text("source_value").notNull(),
  lineOfBusinessId: integer("line_of_business_id").notNull().references(() => linesOfBusiness.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const carrierStatementLayouts = pgTable("carrier_statement_layouts", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  carrierId: integer("carrier_id").notNull().references(() => carriers.id),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  detectionSignatureJson: text("detection_signature_json").notNull(),
  mappingJson: text("mapping_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const importStatements = pgTable("import_statements", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  originalFilename: text("original_filename").notNull(),
  displayName: text("display_name").notNull(),
  paidMonth: text("paid_month").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  sourceType: text("source_type").notNull(),
  status: text("status").notNull(),
  fingerprint: text("fingerprint").notNull(),
  rowCount: integer("row_count").notNull(),
  newGroupCount: integer("new_group_count").notNull(),
  previewJson: text("preview_json"),
  storedPath: text("stored_path"),
  columnMappingJson: text("column_mapping_json"),
  postedRowCount: integer("posted_row_count").notNull(),
  carrierId: integer("carrier_id").references(() => carriers.id),
  layoutId: integer("layout_id").references(() => carrierStatementLayouts.id),
  layoutVersion: integer("layout_version"),
  extractionPath: text("extraction_path"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const groupCompensationAgreements = pgTable("group_compensation_agreements", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  agentId: integer("agent_id").notNull().references(() => agents.id),
  lineOfBusinessId: integer("line_of_business_id").notNull().references(() => linesOfBusiness.id),
  compensationBps: integer("compensation_bps").notNull(),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const commissionRecords = pgTable("commission_records", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  statementMonth: text("statement_month").notNull(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  carrierId: integer("carrier_id").notNull().references(() => carriers.id),
  lineOfBusinessId: integer("line_of_business_id").notNull().references(() => linesOfBusiness.id),
  agentId: integer("agent_id").references(() => agents.id),
  premiumCents: integer("premium_cents"),
  grossCommissionCents: integer("gross_commission_cents").notNull(),
  compensationBps: integer("compensation_bps"),
  agentCompensationCents: integer("agent_compensation_cents").notNull(),
  agencyNetCents: integer("agency_net_cents").notNull(),
  sourceReference: text("source_reference"),
  notes: text("notes"),
  premiumMonth: text("premium_month"),
  importStatementId: integer("import_statement_id").references(() => importStatements.id),
  sourceRowKey: text("source_row_key"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const commissionRecordRelations = relations(commissionRecords, ({ one, many }) => ({
  group: one(groups, { fields: [commissionRecords.groupId], references: [groups.id] }),
  carrier: one(carriers, { fields: [commissionRecords.carrierId], references: [carriers.id] }),
  lineOfBusiness: one(linesOfBusiness, { fields: [commissionRecords.lineOfBusinessId], references: [linesOfBusiness.id] }),
  agent: one(agents, { fields: [commissionRecords.agentId], references: [agents.id] }),
  importStatement: one(importStatements, { fields: [commissionRecords.importStatementId], references: [importStatements.id] }),
  payouts: many(commissionPayouts),
}));

export const teams = pgTable("teams", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const teamMemberships = pgTable("team_memberships", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id),
  personKind: text("person_kind").notNull(),
  personId: integer("person_id").notNull(),
  shareBps: integer("share_bps").notNull(),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end"),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const compensationAllocations = pgTable("compensation_allocations", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  lineOfBusinessId: integer("line_of_business_id").notNull().references(() => linesOfBusiness.id),
  effectiveStart: text("effective_start").notNull(),
  effectiveEnd: text("effective_end"),
  status: text("status").notNull(),
  sourceAgreementId: integer("source_agreement_id").references(() => groupCompensationAgreements.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const compensationAllocationEntries = pgTable("compensation_allocation_entries", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  allocationId: integer("allocation_id").notNull().references(() => compensationAllocations.id),
  recipientType: text("recipient_type").notNull(),
  personKind: text("person_kind"),
  personId: integer("person_id"),
  teamId: integer("team_id").references(() => teams.id),
  compensationBps: integer("compensation_bps").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const commissionPayouts = pgTable("commission_payouts", {
  id: integer("id").generatedByDefaultAsIdentity().primaryKey(),
  commissionId: integer("commission_id").notNull().references(() => commissionRecords.id),
  allocationId: integer("allocation_id").references(() => compensationAllocations.id),
  recipientType: text("recipient_type").notNull(),
  personKind: text("person_kind"),
  personId: integer("person_id"),
  personName: text("person_name"),
  teamId: integer("team_id"),
  teamName: text("team_name"),
  parentPayoutId: integer("parent_payout_id"),
  allocationBps: integer("allocation_bps").notNull(),
  teamInternalBps: integer("team_internal_bps"),
  compensationCents: integer("compensation_cents").notNull(),
  createdAt: text("created_at").notNull(),
});

export type Carrier = typeof carriers.$inferSelect;
export type LineOfBusiness = typeof linesOfBusiness.$inferSelect;
export type AccountManager = typeof accountManagers.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type GroupCompensationAgreement = typeof groupCompensationAgreements.$inferSelect;
export type CommissionRecord = typeof commissionRecords.$inferSelect;
export type ImportStatement = typeof importStatements.$inferSelect;
export type CarrierCoverageAlias = typeof carrierCoverageAliases.$inferSelect;
export type CarrierStatementLayout = typeof carrierStatementLayouts.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type CompensationAllocation = typeof compensationAllocations.$inferSelect;
export type CompensationAllocationEntry = typeof compensationAllocationEntries.$inferSelect;
export type CommissionPayout = typeof commissionPayouts.$inferSelect;
