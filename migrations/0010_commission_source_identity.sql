ALTER TABLE commission_records
  ADD COLUMN IF NOT EXISTS source_coverage_label TEXT;

ALTER TABLE commission_records
  ADD COLUMN IF NOT EXISTS source_group_label TEXT;
