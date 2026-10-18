-- Settings (DESIGN-core 3.7, table `settings`): one row per section of `Settings` (JSON),
-- plus `rev` (the one settings revision), `hotkeys` and `setup` (which never move `rev`).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The glossary (PRD table, with `rev`); lists and the language are JSON text.
CREATE TABLE glossary (
  id                TEXT PRIMARY KEY,
  term              TEXT NOT NULL,
  variants_latin    TEXT NOT NULL,
  variants_cyrillic TEXT NOT NULL,
  spoken_forms      TEXT NOT NULL,
  lang              TEXT,
  always_apply      INTEGER NOT NULL,
  added_from        TEXT,
  rev               INTEGER NOT NULL
);
CREATE UNIQUE INDEX glossary_term ON glossary (lower(term));
