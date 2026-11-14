DROP TRIGGER segments_fts_insert;
DROP TRIGGER segments_fts_update;
DROP TRIGGER segments_fts_delete;

CREATE TRIGGER segments_fts_insert AFTER INSERT ON segments BEGIN
  INSERT INTO segments_fts (rowid, body)
    SELECT new.rowid, ' ' || noter_word_boundaries(new.text_norm)
    WHERE new.pass = 'archive' OR NOT EXISTS (
      SELECT 1 FROM segments WHERE call_id = new.call_id AND pass = 'archive'
    );
  DELETE FROM segments_fts WHERE rowid IN (
    SELECT rowid FROM segments WHERE call_id = new.call_id AND pass = 'live'
  ) AND EXISTS (
    SELECT 1 FROM segments WHERE call_id = new.call_id AND pass = 'archive'
  );
END;

CREATE TRIGGER segments_fts_update AFTER UPDATE OF text_norm, pass ON segments BEGIN
  DELETE FROM segments_fts WHERE rowid = old.rowid;
  INSERT INTO segments_fts (rowid, body)
    SELECT new.rowid, ' ' || noter_word_boundaries(new.text_norm)
    WHERE new.pass = 'archive' OR NOT EXISTS (
      SELECT 1 FROM segments WHERE call_id = new.call_id AND pass = 'archive'
    );
  DELETE FROM segments_fts WHERE rowid IN (
    SELECT rowid FROM segments WHERE call_id = new.call_id AND pass = 'live'
  ) AND EXISTS (
    SELECT 1 FROM segments WHERE call_id = new.call_id AND pass = 'archive'
  );
END;

CREATE TRIGGER segments_fts_delete AFTER DELETE ON segments BEGIN
  DELETE FROM segments_fts WHERE rowid = old.rowid;
  INSERT INTO segments_fts (rowid, body)
    SELECT rowid, ' ' || noter_word_boundaries(text_norm)
    FROM segments
    WHERE old.pass = 'archive'
      AND call_id = old.call_id
      AND pass = 'live'
      AND NOT EXISTS (
        SELECT 1 FROM segments WHERE call_id = old.call_id AND pass = 'archive'
      );
END;

DELETE FROM segments_fts;
INSERT INTO segments_fts (rowid, body)
  SELECT s.rowid, ' ' || noter_word_boundaries(s.text_norm)
  FROM segments s
  WHERE s.pass = 'archive' OR NOT EXISTS (
    SELECT 1 FROM segments a WHERE a.call_id = s.call_id AND a.pass = 'archive'
  );
