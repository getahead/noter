-- Retrieval chunks of a call's active transcript (DESIGN-core 3.7, table `chunks`): speaker-
-- prefixed lines under a call header, about 200–300 tokens each, with the canonical bge-m3
-- embedding (float32[1024], little-endian). `chunk_vec` is rebuilt from `embedding` in M3; a NULL
-- embedding is a chunk whose embedding failed and waits for the next pass.
CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  t0_ms       INTEGER NOT NULL,
  t1_ms       INTEGER NOT NULL,
  text        TEXT NOT NULL,
  text_norm   TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding   BLOB
);
CREATE INDEX chunks_call ON chunks (call_id, t0_ms);

-- Both candidate speakers of an archive overlap (D-40): a JSON list of `speakers.id`, empty
-- otherwise.
ALTER TABLE segments ADD COLUMN crosstalk_with TEXT NOT NULL DEFAULT '[]';
