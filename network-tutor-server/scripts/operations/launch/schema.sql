
-- One-way phase2 beta -> official transition. Never applied to the phase1 archive.
CREATE TABLE IF NOT EXISTS service_launch (
  id SMALLINT PRIMARY KEY CHECK (id=1),
  stage TEXT NOT NULL CHECK (stage IN ('beta','starting','official')),
  request_id UUID,
  requested_by INT,
  requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  backup_file TEXT,
  last_error TEXT
);
INSERT INTO service_launch(id,stage) VALUES(1,'beta') ON CONFLICT(id) DO NOTHING;
