CREATE TABLE carriers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX carriers_name_unique ON carriers (name);

CREATE TABLE lines_of_business (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX lines_of_business_name_unique ON lines_of_business (name);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  default_compensation_bps INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    default_compensation_bps IS NULL
    OR (default_compensation_bps >= 0 AND default_compensation_bps <= 10000)
  )
);

CREATE TABLE commission_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_month TEXT NOT NULL,
  group_id INTEGER NOT NULL REFERENCES groups (id),
  carrier_id INTEGER NOT NULL REFERENCES carriers (id),
  line_of_business_id INTEGER NOT NULL REFERENCES lines_of_business (id),
  agent_id INTEGER REFERENCES agents (id),
  premium_cents INTEGER,
  gross_commission_cents INTEGER NOT NULL,
  compensation_bps INTEGER,
  agent_compensation_cents INTEGER NOT NULL,
  agency_net_cents INTEGER NOT NULL,
  source_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (statement_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  CHECK (premium_cents IS NULL OR typeof(premium_cents) = 'integer'),
  CHECK (typeof(gross_commission_cents) = 'integer'),
  CHECK (typeof(agent_compensation_cents) = 'integer'),
  CHECK (typeof(agency_net_cents) = 'integer'),
  CHECK (
    compensation_bps IS NULL
    OR (compensation_bps >= 0 AND compensation_bps <= 10000)
  ),
  CHECK (agency_net_cents = gross_commission_cents - agent_compensation_cents)
);

CREATE INDEX commission_records_month_idx ON commission_records (statement_month);
CREATE INDEX commission_records_group_idx ON commission_records (group_id);
CREATE INDEX commission_records_carrier_idx ON commission_records (carrier_id);
CREATE INDEX commission_records_agent_idx ON commission_records (agent_id);
