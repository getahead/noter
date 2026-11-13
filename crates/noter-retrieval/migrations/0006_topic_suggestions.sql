CREATE TABLE topic_suggestions (
  topic_id  TEXT PRIMARY KEY REFERENCES topics (id) ON DELETE CASCADE,
  target_id TEXT REFERENCES topics (id) ON DELETE CASCADE
);

CREATE INDEX topic_suggestions_target ON topic_suggestions (target_id);
