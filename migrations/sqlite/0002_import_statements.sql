CREATE TABLE import_statements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL,
  display_name TEXT NOT NULL,
  paid_month TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  new_group_count INTEGER NOT NULL DEFAULT 0,
  preview_json TEXT,
  stored_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (paid_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);

CREATE UNIQUE INDEX import_statements_fingerprint_unique ON import_statements (fingerprint);
CREATE INDEX import_statements_paid_month_idx ON import_statements (paid_month);
