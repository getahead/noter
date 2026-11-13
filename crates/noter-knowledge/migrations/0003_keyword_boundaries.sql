-- The same Unicode word boundaries as the call indexes and query terms.
DROP TRIGGER doc_chunks_ai;
CREATE TRIGGER doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
  INSERT INTO doc_chunks_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(new.text_norm));
  INSERT INTO doc_vec (chunk_id, privacy_class, embedding)
    SELECT new.id, s.privacy_class, new.embedding
    FROM documents d JOIN sources s ON s.id = d.source_id
    WHERE d.id = new.document_id AND new.embedding IS NOT NULL;
END;

DELETE FROM doc_chunks_fts;
INSERT INTO doc_chunks_fts (rowid, body)
  SELECT rowid, ' ' || noter_word_boundaries(text_norm) FROM doc_chunks;
