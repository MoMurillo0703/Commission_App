CREATE TABLE group_compensation_agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups (id),
  agent_id INTEGER NOT NULL REFERENCES agents (id),
  line_of_business_id INTEGER NOT NULL REFERENCES lines_of_business (id),
  compensation_bps INTEGER NOT NULL,
  effective_start TEXT NOT NULL,
  effective_end TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (compensation_bps >= 0 AND compensation_bps <= 10000),
  CHECK (effective_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  CHECK (effective_end IS NULL OR effective_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  CHECK (effective_end IS NULL OR effective_end >= effective_start),
  CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX group_comp_agreements_lookup_idx
  ON group_compensation_agreements (group_id, agent_id, line_of_business_id, effective_start);

CREATE INDEX group_comp_agreements_group_idx ON group_compensation_agreements (group_id);
CREATE INDEX group_comp_agreements_agent_idx ON group_compensation_agreements (agent_id);
