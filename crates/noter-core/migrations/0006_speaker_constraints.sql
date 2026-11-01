-- Speaker names and the constraints a user correction leaves for the archive pass
-- (DESIGN-core cpt-noter-dbtable-speaker-constraints).
-- `label` stays the engine's label (the live pass maps its voices by it); `name` is what the user
-- called the speaker. shortcut: no `people` table before library-people (M3), so `person_id` is
-- an id the core mints and the name lives on the speaker rows.
ALTER TABLE speakers ADD COLUMN name TEXT;

-- Spans are call ms on the system channel; the id is made from the spans so a repeated
-- correction writes the same row.
CREATE TABLE speaker_constraints (
  id      TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('must_link', 'cannot_link')),
  a_t0_ms INTEGER NOT NULL,
  a_t1_ms INTEGER NOT NULL,
  b_t0_ms INTEGER NOT NULL,
  b_t1_ms INTEGER NOT NULL
);
CREATE INDEX speaker_constraints_call ON speaker_constraints (call_id);
