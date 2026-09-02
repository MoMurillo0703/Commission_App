CREATE TABLE account_managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX account_managers_name_unique ON account_managers (name);

ALTER TABLE groups ADD COLUMN account_manager_id INTEGER REFERENCES account_managers (id);
ALTER TABLE groups ADD COLUMN primary_agent_id INTEGER REFERENCES agents (id);
ALTER TABLE groups ADD COLUMN default_compensation_bps INTEGER;

CREATE INDEX groups_account_manager_idx ON groups (account_manager_id);
CREATE INDEX groups_primary_agent_idx ON groups (primary_agent_id);
