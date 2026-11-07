-- People, aliases, call participation and voice profiles (DESIGN-core cpt-noter-dbtable-people,
-- -call-participants, -voice-profiles; TL-34, TL-39).
-- `person_aliases` and `call_participants` carry an `id` the DESIGN keys do not list: undo and
-- redo replay a change row by `id`, and a merge moves, adds and removes these rows as one batch.
-- Their natural keys stay unique. No FK is added to `speakers.person_id` or
-- `items.owner_person_id`: SQLite adds one only by rebuilding the table, and `person_delete`
-- and `people_merge` rewrite both columns in their own transaction.
CREATE TABLE people (
  id                  TEXT PRIMARY KEY,
  rev                 INTEGER NOT NULL,
  display_name        TEXT NOT NULL,
  short_name          TEXT NOT NULL,
  email               TEXT,
  role                TEXT,
  org                 TEXT,
  notes               TEXT,
  is_you              INTEGER NOT NULL DEFAULT 0 CHECK (is_you IN (0, 1)),
  voice_profile_optin INTEGER NOT NULL DEFAULT 0 CHECK (voice_profile_optin IN (0, 1)),
  optin_date          INTEGER
);
CREATE UNIQUE INDEX people_is_you ON people (is_you) WHERE is_you = 1;

INSERT INTO people (id, rev, display_name, short_name, is_you) VALUES ('per_you', 1, 'You', 'You', 1);

-- People the M2 naming already minted: one row per person id a speaker carries, named by the
-- latest speaker row. A short name is the first word and the initial of the second.
INSERT INTO people (id, rev, display_name, short_name)
SELECT n.person_id, 1, n.name,
       CASE WHEN instr(n.name, ' ') > 0
            THEN substr(n.name, 1, instr(n.name, ' ') - 1) || ' '
                 || substr(ltrim(substr(n.name, instr(n.name, ' ') + 1)), 1, 1) || '.'
            ELSE n.name END
FROM (SELECT person_id, COALESCE(NULLIF(trim(name), ''), label) AS name, max(rowid)
      FROM speakers WHERE person_id IS NOT NULL AND person_id != 'per_you'
      GROUP BY person_id) n;

CREATE TABLE person_aliases (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  UNIQUE (person_id, alias_norm)
);

-- Filled from calendar attendees and named speakers; `talk_time_ms` only for calls recorded
-- while behaviour metrics were on (D5), never back-computed.
CREATE TABLE call_participants (
  id           TEXT PRIMARY KEY,
  call_id      TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  person_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  talk_time_ms INTEGER,
  UNIQUE (call_id, person_id)
);
CREATE INDEX call_participants_person ON call_participants (person_id);

-- Never exported or synced; the embedding is encrypted (slice 2 writes it).
CREATE TABLE voice_profiles (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  embedding    BLOB NOT NULL,
  device_hint  TEXT,
  sample_count INTEGER NOT NULL DEFAULT 1,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX voice_profiles_person ON voice_profiles (person_id);
