-- Retrieval and Ask (DESIGN-core 3.7: `topics`, `suppressions`, `ask_threads`; TL-34). Runs after
-- noter-core's list: the shadow tables and their triggers read `segments`, `items` and `chunks`.

CREATE TABLE topics (
  id         TEXT PRIMARY KEY,
  rev        INTEGER NOT NULL,
  name       TEXT NOT NULL,
  centroid   BLOB,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE topic_aliases (
  topic_id TEXT NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  alias    TEXT NOT NULL,
  PRIMARY KEY (topic_id, alias)
);

CREATE TABLE suppressions (
  kind       TEXT NOT NULL CHECK (kind IN ('topic_merge', 'person_merge', 'rejected_item', 'term')),
  key        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE TABLE ask_threads (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  -- JSON `AskScope`.
  scope      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ask_turns (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES ask_threads (id) ON DELETE CASCADE,
  question   TEXT NOT NULL,
  -- NULL until the answer is stored.
  answer_md  TEXT,
  citations  TEXT NOT NULL DEFAULT '[]',
  found      INTEGER CHECK (found IN (0, 1)),
  runtime    TEXT,
  llm_run_id TEXT,
  asked_at   INTEGER NOT NULL
);
CREATE INDEX ask_turns_thread ON ask_turns (thread_id, asked_at);

-- Vectors (sqlite-vec): `chunk_vec` has no partition key, `call_id` and `started_at` are metadata
-- columns (DESIGN-core 3.7); both tables are rebuilt from canonical data (`chunks.embedding`, the
-- item's text embedded locally).
CREATE VIRTUAL TABLE chunk_vec USING vec0(
  chunk_id TEXT PRIMARY KEY,
  embedding float[1024] distance_metric=cosine,
  call_id TEXT,
  started_at INTEGER
);
CREATE VIRTUAL TABLE item_vec USING vec0(
  item_id TEXT PRIMARY KEY,
  embedding float[1024] distance_metric=cosine,
  call_id TEXT,
  started_at INTEGER
);

-- Keyword shadows: trigram FTS5 over the normalised text (lower case, ё → е, ß → ss; the tokenizer
-- folds case), keyed by the source row's rowid. A leading space, and spaces for line breaks and
-- the punctuation that starts words, let a query term match at word starts only (`" term"`). The triggers keep
-- them current for every writer.
CREATE VIRTUAL TABLE segments_fts USING fts5(body, content = '', contentless_delete = 1, tokenize = 'trigram');
CREATE VIRTUAL TABLE items_fts USING fts5(body, content = '', contentless_delete = 1, tokenize = 'trigram');
CREATE VIRTUAL TABLE chunks_fts USING fts5(body, content = '', contentless_delete = 1, tokenize = 'trigram');

CREATE TRIGGER segments_fts_insert AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(' ' || replace(new.text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
END;
CREATE TRIGGER segments_fts_update AFTER UPDATE OF text_norm ON segments BEGIN
  DELETE FROM segments_fts WHERE rowid = old.rowid;
  INSERT INTO segments_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(' ' || replace(new.text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
END;
CREATE TRIGGER segments_fts_delete AFTER DELETE ON segments BEGIN
  DELETE FROM segments_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(replace(replace(replace(' ' || replace(new.text, char(10), ' '),
      'Ё', 'е'), 'ё', 'е'), 'ß', 'ss'), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
END;
CREATE TRIGGER items_fts_update AFTER UPDATE OF text ON items WHEN old.text IS NOT new.text BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
  INSERT INTO items_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(replace(replace(replace(' ' || replace(new.text, char(10), ' '),
      'Ё', 'е'), 'ё', 'е'), 'ß', 'ss'), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
  -- The vector described the old text: the next rebuild embeds the item again.
  DELETE FROM item_vec WHERE item_id = old.id;
END;
CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
  DELETE FROM item_vec WHERE item_id = old.id;
END;

-- Chunks are only inserted and deleted (`chunks.rs` replaces a call's chunks): a new chunk lands
-- in `chunks_fts` and, with its embedding, in `chunk_vec` as it is written.
CREATE TRIGGER chunks_index_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(' ' || replace(new.text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
  INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
    SELECT new.id, new.embedding, new.call_id, c.started_at FROM calls c
    WHERE c.id = new.call_id AND new.embedding IS NOT NULL;
END;
CREATE TRIGGER chunks_index_delete AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE rowid = old.rowid;
  DELETE FROM chunk_vec WHERE chunk_id = old.id;
END;

-- Rows written before this migration: keyword shadows now, vectors by the startup rebuild.
INSERT INTO segments_fts (rowid, body) SELECT rowid,
  replace(replace(replace(replace(replace(' ' || replace(text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' ')
  FROM segments;
INSERT INTO items_fts (rowid, body) SELECT rowid,
  replace(replace(replace(replace(replace(replace(replace(replace(' ' || replace(text, char(10), ' '),
    'Ё', 'е'), 'ё', 'е'), 'ß', 'ss'), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' ')
  FROM items;
INSERT INTO chunks_fts (rowid, body) SELECT rowid,
  replace(replace(replace(replace(replace(' ' || replace(text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' ')
  FROM chunks;
