-- Topic aliases get row ids: a merge moves, adds and removes them as logged changes, and the
-- history service restores rows by id (DESIGN-core 3.7 `topics`; noter-db `replay`).

CREATE TABLE topic_aliases_new (
  id       TEXT PRIMARY KEY NOT NULL DEFAULT ('tal_' || lower(hex(randomblob(10)))),
  topic_id TEXT NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  alias    TEXT NOT NULL,
  UNIQUE (topic_id, alias)
);
INSERT INTO topic_aliases_new (topic_id, alias) SELECT topic_id, alias FROM topic_aliases;
DROP TABLE topic_aliases;
ALTER TABLE topic_aliases_new RENAME TO topic_aliases;

-- Topic lists, threads and centroids read a topic's items.
CREATE INDEX items_topic ON items (topic_id);
