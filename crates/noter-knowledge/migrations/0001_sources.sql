-- Knowledge sources and their local index (DESIGN-core cpt-noter-dbtable-sources; `documents`,
-- `doc_chunks`, `doc_vec` and `sync_runs` as PRD › Data model lists them). Removing a source
-- cascades to its documents, chunks and sync runs; the triggers keep the keyword and vector
-- indexes in the same transaction.
CREATE TABLE sources (
  id            TEXT PRIMARY KEY,
  rev           INTEGER NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('folder', 'mcp')),
  mode          TEXT NOT NULL CHECK (mode IN ('live', 'indexed')),
  name          TEXT NOT NULL,
  location      TEXT NOT NULL,
  -- NULL: the app is unsandboxed and reads folders by path (TL-29).
  bookmark      BLOB,
  schedule      TEXT,
  privacy_class TEXT NOT NULL CHECK (privacy_class IN ('normal', 'sensitive')),
  -- `SourceScope` as JSON.
  scope         TEXT NOT NULL,
  -- The Keychain item's name, never the token.
  token_ref     TEXT,
  -- `SourceStatus` as JSON.
  status        TEXT NOT NULL,
  last_sync_at  INTEGER
);

CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  -- A file path inside the folder, or the page's URI.
  uri          TEXT NOT NULL,
  title        TEXT NOT NULL,
  mime         TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  modified_at  INTEGER,
  indexed_at   INTEGER NOT NULL,
  UNIQUE (source_id, uri)
);

-- Retrieval units by heading, 200–400 tokens, title and heading path prepended to `text`;
-- `embedding` is the canonical bge-m3 vector (float32[1024], little-endian).
CREATE TABLE doc_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  -- JSON array of headings, outermost first.
  heading_path TEXT NOT NULL,
  text         TEXT NOT NULL,
  -- NFKC, lower case, ё → е, ß → ss: what the keyword index holds.
  text_norm    TEXT NOT NULL,
  token_count  INTEGER NOT NULL,
  embedding    BLOB
);
CREATE INDEX doc_chunks_document ON doc_chunks (document_id);

CREATE VIRTUAL TABLE doc_chunks_fts USING fts5 (
  text_norm, content = 'doc_chunks', content_rowid = 'rowid'
);

-- Partitioned by the source's privacy class (PRD); rebuildable from `doc_chunks.embedding`.
CREATE VIRTUAL TABLE doc_vec USING vec0 (
  chunk_id TEXT PRIMARY KEY,
  privacy_class TEXT PARTITION KEY,
  embedding float[1024] distance_metric=cosine
);

CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (rowid, text_norm) VALUES (new.rowid, new.text_norm);
  INSERT INTO doc_vec (chunk_id, privacy_class, embedding)
    SELECT new.id, s.privacy_class, new.embedding
    FROM documents d JOIN sources s ON s.id = d.source_id
    WHERE d.id = new.document_id AND new.embedding IS NOT NULL;
END;

CREATE TRIGGER doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (doc_chunks_fts, rowid, text_norm)
    VALUES ('delete', old.rowid, old.text_norm);
  DELETE FROM doc_vec WHERE chunk_id = old.id;
END;

CREATE TABLE sync_runs (
  id          TEXT PRIMARY KEY,
  source_id   TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  added       INTEGER NOT NULL DEFAULT 0,
  changed     INTEGER NOT NULL DEFAULT 0,
  removed     INTEGER NOT NULL DEFAULT 0,
  -- The typed error code (`source_sync_failed`, `cancelled`, …); NULL on success.
  error       TEXT
);
CREATE INDEX sync_runs_source ON sync_runs (source_id, started_at);
