-- Pipeline and maintenance jobs (DESIGN-core cpt-noter-dbtable-jobs) and their runs.
CREATE TABLE jobs (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL UNIQUE,
  trigger          TEXT NOT NULL,
  -- Hours "HH-HH" (UTC) of the nightly window; NULL for the other triggers.
  schedule         TEXT,
  enabled          INTEGER NOT NULL DEFAULT 1,
  allow_on_battery INTEGER NOT NULL DEFAULT 0,
  last_run_at      INTEGER
);

CREATE TABLE job_runs (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES jobs (id),
  -- What the run works on (a call id, a model id); NULL for work with no subject.
  subject     TEXT,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
  counts      TEXT NOT NULL DEFAULT '[]',
  error_code  TEXT,
  progress    REAL
);
CREATE INDEX job_runs_job ON job_runs (job_id, started_at);
CREATE INDEX job_runs_status ON job_runs (status);
