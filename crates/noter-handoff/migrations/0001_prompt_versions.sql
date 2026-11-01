-- Handoff prompts, every version and the user's edit (DESIGN-core cpt-noter-dbtable-prompt-versions).
CREATE TABLE prompt_versions (
  id          TEXT PRIMARY KEY,
  -- NULL for improvement briefs (M5).
  item_id     TEXT REFERENCES items (id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('generated', 'user_edit')),
  -- The skill's structured output; NULL for a user edit, which has none.
  output_json TEXT,
  body_md     TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  UNIQUE (item_id, n)
);
