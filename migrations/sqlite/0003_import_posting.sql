ALTER TABLE commission_records ADD COLUMN premium_month TEXT;
ALTER TABLE commission_records ADD COLUMN import_statement_id INTEGER REFERENCES import_statements (id);
ALTER TABLE commission_records ADD COLUMN source_row_key TEXT;

CREATE UNIQUE INDEX commission_records_import_row_unique
  ON commission_records (import_statement_id, source_row_key)
  WHERE import_statement_id IS NOT NULL AND source_row_key IS NOT NULL;

ALTER TABLE import_statements ADD COLUMN column_mapping_json TEXT;
ALTER TABLE import_statements ADD COLUMN posted_row_count INTEGER NOT NULL DEFAULT 0;
