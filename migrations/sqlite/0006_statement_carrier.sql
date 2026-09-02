ALTER TABLE import_statements ADD COLUMN carrier_id INTEGER REFERENCES carriers (id);

CREATE INDEX import_statements_carrier_idx ON import_statements (carrier_id);
