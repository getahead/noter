-- Document keywords in the shape retrieval matches every other section (noter-retrieval
-- 0001): trigram FTS5 over the normalised text with a leading space, and spaces for line breaks
-- and the punctuation that starts words, so a query term `" term"` matches at word starts only.
-- Contentless, keyed by the chunk's rowid; the triggers keep it with the vectors.
DROP TRIGGER doc_chunks_ai;
DROP TRIGGER doc_chunks_ad;
DROP TABLE doc_chunks_fts;

CREATE VIRTUAL TABLE doc_chunks_fts USING fts5(
  body, content = '', contentless_delete = 1, tokenize = 'trigram'
);

CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (rowid, body) VALUES (new.rowid,
    replace(replace(replace(replace(replace(' ' || replace(new.text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' '));
  INSERT INTO doc_vec (chunk_id, privacy_class, embedding)
    SELECT new.id, s.privacy_class, new.embedding
    FROM documents d JOIN sources s ON s.id = d.source_id
    WHERE d.id = new.document_id AND new.embedding IS NOT NULL;
END;

CREATE TRIGGER doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
  DELETE FROM doc_chunks_fts WHERE rowid = old.rowid;
  DELETE FROM doc_vec WHERE chunk_id = old.id;
END;

INSERT INTO doc_chunks_fts (rowid, body) SELECT rowid,
  replace(replace(replace(replace(replace(' ' || replace(text_norm, char(10), ' '), '-', ' '), '(', ' '), '"', ' '), '«', ' '), '/', ' ')
  FROM doc_chunks;
