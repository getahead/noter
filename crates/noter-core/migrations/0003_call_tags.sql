-- Free-text call tags (DESIGN-core 3.7, table `call_tags`, D90): a junction table, one row per
-- tag of a call, unique ignoring case. Tags go with their call (FK cascade).
CREATE TABLE call_tags (
  call_id  TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  tag      TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 32),
  tag_norm TEXT NOT NULL,
  PRIMARY KEY (call_id, tag_norm)
);
CREATE INDEX call_tags_norm ON call_tags (tag_norm);
