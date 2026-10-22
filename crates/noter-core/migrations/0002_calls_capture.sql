-- Calls and their capture data (DESIGN-core 3.7, tables `calls`, `speakers`, `segments`, `marks`,
-- `gaps`). Capture rows go with their call (FK cascade). Enum columns use the protocol's
-- snake_case words: CallStatus, PrivacyClass, OutputsStatus, ArchiveStatus, EffectiveMode,
-- NamedBy, GapReason.
CREATE TABLE calls (
  id                    TEXT PRIMARY KEY,
  rev                   INTEGER NOT NULL,
  started_at            INTEGER NOT NULL,
  -- NULL while the call is recording or paused.
  ended_at              INTEGER,
  title                 TEXT NOT NULL,
  call_type             TEXT NOT NULL,
  platform              TEXT,
  calendar_event_id     TEXT,
  privacy_class         TEXT NOT NULL DEFAULT 'normal' CHECK (privacy_class IN ('normal', 'sensitive')),
  status                TEXT NOT NULL
                        CHECK (status IN ('recording', 'paused', 'processing', 'ready', 'failed')),
  outputs_status        TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (outputs_status IN ('not_started', 'writing', 'ready', 'partially_failed', 'failed')),
  archive_status        TEXT NOT NULL DEFAULT 'not_started'
                        CHECK (archive_status IN ('not_started', 'pending', 'running', 'done', 'failed')),
  audio_retention_until INTEGER,
  audio_deleted         INTEGER NOT NULL DEFAULT 0 CHECK (audio_deleted IN (0, 1)),
  audio_not_stored      INTEGER NOT NULL DEFAULT 0 CHECK (audio_not_stored IN (0, 1)),
  mode_used             TEXT NOT NULL CHECK (mode_used IN
                          ('cloud', 'cloud_redacted', 'local_only', 'sensitive_local', 'switched_to_local'))
);
CREATE INDEX calls_started_at ON calls (started_at);

CREATE TABLE speakers (
  id        TEXT PRIMARY KEY,
  call_id   TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  n         INTEGER,
  channel   TEXT NOT NULL CHECK (channel IN ('mic', 'sys')),
  -- shortcut: no FK until the `people` table lands (library-people); add it in that migration.
  person_id TEXT,
  named_by  TEXT CHECK (named_by IN ('you', 'voice_profile', 'calendar')),
  centroid  BLOB,
  pass      TEXT NOT NULL CHECK (pass IN ('live', 'archive')),
  UNIQUE (call_id, label, pass)
);

CREATE TABLE segments (
  id          TEXT PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  speaker_id  TEXT REFERENCES speakers (id),
  channel     TEXT NOT NULL CHECK (channel IN ('mic', 'sys')),
  t0_ms       INTEGER NOT NULL,
  t1_ms       INTEGER NOT NULL,
  text        TEXT NOT NULL,
  text_norm   TEXT NOT NULL,
  lang        TEXT,
  lang_p      REAL,
  avg_logprob REAL,
  no_speech_p REAL,
  pass        TEXT NOT NULL CHECK (pass IN ('live', 'archive')),
  words_path  TEXT,
  corrections TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX segments_call ON segments (call_id, pass, t0_ms);
CREATE INDEX segments_speaker ON segments (speaker_id);

CREATE TABLE marks (
  id      TEXT PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  at_ms   INTEGER NOT NULL,
  note    TEXT
);
CREATE INDEX marks_call ON marks (call_id, at_ms);

CREATE TABLE gaps (
  call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  t0_ms   INTEGER NOT NULL,
  t1_ms   INTEGER NOT NULL,
  reason  TEXT NOT NULL CHECK (reason IN
            ('paused', 'device_changed', 'system_audio_silent', 'engine_restart', 'stalled', 'interrupted', 'continued')),
  PRIMARY KEY (call_id, t0_ms)
);
