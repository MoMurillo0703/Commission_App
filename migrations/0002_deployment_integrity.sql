ALTER TABLE import_statements
  ADD CONSTRAINT import_statements_paid_month_calendar_check
  CHECK (paid_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE group_compensation_agreements
  ADD CONSTRAINT group_comp_agreements_start_calendar_check
  CHECK (effective_start ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE group_compensation_agreements
  ADD CONSTRAINT group_comp_agreements_end_calendar_check
  CHECK (effective_end IS NULL OR effective_end ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE commission_records
  ADD CONSTRAINT commission_records_statement_month_calendar_check
  CHECK (statement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE commission_records
  ADD CONSTRAINT commission_records_premium_month_calendar_check
  CHECK (premium_month IS NULL OR premium_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;

ALTER TABLE carriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE lines_of_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_compensation_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION prevent_overlapping_compensation_agreements() FROM PUBLIC;
