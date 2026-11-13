-- Match the query side's Unicode alphanumeric word boundaries, preserving canonical text.
-- Rebuild only keyword shadows; embeddings and vector indexes remain valid.
DROP TRIGGER segments_fts_insert;
CREATE TRIGGER segments_fts_insert AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(new.text_norm));
END;

DROP TRIGGER segments_fts_update;
CREATE TRIGGER segments_fts_update AFTER UPDATE OF text_norm ON segments BEGIN
  DELETE FROM segments_fts WHERE rowid = old.rowid;
  INSERT INTO segments_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(new.text_norm));
END;

DROP TRIGGER items_fts_insert;
CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
  INSERT INTO items_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(replace(replace(replace(new.text, 'Ё', 'е'), 'ё', 'е'), 'ß', 'ss')));
END;

DROP TRIGGER items_fts_update;
CREATE TRIGGER items_fts_update AFTER UPDATE OF text ON items WHEN old.text IS NOT new.text BEGIN
  DELETE FROM items_fts WHERE rowid = old.rowid;
  INSERT INTO items_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(replace(replace(replace(new.text, 'Ё', 'е'), 'ё', 'е'), 'ß', 'ss')));
  -- The vector described the old text: the next rebuild embeds the item again.
  DELETE FROM item_vec WHERE item_id = old.id;
END;

DROP TRIGGER chunks_index_insert;
CREATE TRIGGER chunks_index_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, body) VALUES (new.rowid, ' ' || noter_word_boundaries(new.text_norm));
  INSERT INTO chunk_vec (chunk_id, embedding, call_id, started_at)
    SELECT new.id, new.embedding, new.call_id, c.started_at FROM calls c
    WHERE c.id = new.call_id AND new.embedding IS NOT NULL;
END;

DELETE FROM segments_fts;
INSERT INTO segments_fts (rowid, body) SELECT rowid, ' ' || noter_word_boundaries(text_norm) FROM segments;
DELETE FROM items_fts;
INSERT INTO items_fts (rowid, body) SELECT rowid, ' ' || noter_word_boundaries(replace(replace(replace(text, 'Ё', 'е'), 'ё', 'е'), 'ß', 'ss')) FROM items;
DELETE FROM chunks_fts;
INSERT INTO chunks_fts (rowid, body) SELECT rowid, ' ' || noter_word_boundaries(text_norm) FROM chunks;
