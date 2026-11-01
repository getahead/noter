-- Output sections and every version of them (DESIGN-core 3.7, tables `summaries` and
-- `summary_versions`): one text section per call and kind (one role review per agent), every
-- generated version and the user's edit. A section and its current version point at each other,
-- so both foreign keys are checked when the transaction commits.
CREATE TABLE summaries (
  id                     TEXT PRIMARY KEY,
  rev                    INTEGER NOT NULL,
  call_id                TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL CHECK (kind IN ('summary', 'decisions', 'action_items',
                           'open_questions', 'per_participant', 'role_reviews', 'risks', 'call_type_extras')),
  -- shortcut: no FK until the `agents` table lands (M4 role reviews); add it in that migration.
  agent_id               TEXT,
  current_version_id     TEXT NOT NULL REFERENCES summary_versions (id) DEFERRABLE INITIALLY DEFERRED,
  user_edited            INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  regenerated_with_edits INTEGER NOT NULL DEFAULT 0 CHECK (regenerated_with_edits IN (0, 1))
);
-- Unique (call_id, kind, agent_id), with no agent counted as one value.
CREATE UNIQUE INDEX summaries_section ON summaries (call_id, kind, ifnull(agent_id, ''));

CREATE TABLE summary_versions (
  id            TEXT PRIMARY KEY,
  summary_id    TEXT NOT NULL REFERENCES summaries (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  n             INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('generated', 'user_edit')),
  -- Markdown without raw HTML.
  body_md       TEXT NOT NULL,
  lang          TEXT NOT NULL,
  skill_version TEXT,
  llm_run_id    TEXT REFERENCES llm_runs (id),
  from_pass     TEXT NOT NULL CHECK (from_pass IN ('live', 'archive')),
  created_at    INTEGER NOT NULL,
  UNIQUE (summary_id, n)
);
