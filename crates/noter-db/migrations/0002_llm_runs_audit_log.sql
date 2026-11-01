-- Every model run (DESIGN-core 3.7, table `llm_runs`): metadata only, never the prompt or transcript text.
CREATE TABLE llm_runs (
  id             TEXT PRIMARY KEY,
  adapter        TEXT NOT NULL,
  runtime_choice TEXT NOT NULL,
  model          TEXT NOT NULL,
  skill          TEXT NOT NULL,
  skill_version  TEXT NOT NULL,
  agent_id       TEXT,
  call_id        TEXT,
  prompt_hash    TEXT NOT NULL,
  tokens_in      INTEGER NOT NULL DEFAULT 0,
  tokens_out     INTEGER NOT NULL DEFAULT 0,
  -- NULL on own accounts and local runs: the cost metric counts API-key runs only.
  cost_usd       REAL,
  duration_ms    INTEGER NOT NULL DEFAULT 0,
  first_token_ms INTEGER,
  schema_ok      INTEGER NOT NULL DEFAULT 0,
  retried        INTEGER NOT NULL DEFAULT 0,
  session_id     TEXT
);
CREATE INDEX llm_runs_call ON llm_runs (call_id);

-- Everything that left the Mac (DESIGN-core 3.7, table `audit_log`), committed before the request is released.
CREATE TABLE audit_log (
  id               TEXT PRIMARY KEY,
  ts               INTEGER NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('run', 'tool_result', 'lookup')),
  what             TEXT NOT NULL,
  destination      TEXT NOT NULL,
  runtime_choice   TEXT,
  call_id          TEXT,
  llm_run_id       TEXT REFERENCES llm_runs (id),
  bytes_out        INTEGER NOT NULL,
  payload_hash     TEXT NOT NULL,
  redaction_map_id TEXT
);
CREATE INDEX audit_log_ts ON audit_log (ts);
CREATE INDEX audit_log_run ON audit_log (llm_run_id);

CREATE TRIGGER audit_log_append_only BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
