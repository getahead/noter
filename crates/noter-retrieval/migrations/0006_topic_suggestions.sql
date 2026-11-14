CREATE TABLE topic_suggestions (
  topic_id    TEXT PRIMARY KEY REFERENCES topics (id) ON DELETE CASCADE,
  target_id   TEXT REFERENCES topics (id) ON DELETE SET NULL,
  similarity  REAL
);

CREATE INDEX topic_suggestions_target ON topic_suggestions (target_id);

WITH candidates AS (
  SELECT source.id AS topic_id, target.id AS target_id,
         vec_distance_cosine(source.centroid, target.centroid) AS distance
  FROM topics source
  JOIN topics target ON target.id != source.id
  WHERE source.centroid IS NOT NULL
    AND target.centroid IS NOT NULL
    AND length(source.centroid) = length(target.centroid)
    AND NOT EXISTS (
      SELECT 1 FROM suppressions kept
      WHERE kept.kind = 'topic_merge'
        AND kept.key = CASE WHEN source.id < target.id
          THEN source.id || '|' || target.id
          ELSE target.id || '|' || source.id END
    )
), ranked AS (
  SELECT topic_id, target_id, distance,
         row_number() OVER (PARTITION BY topic_id ORDER BY distance, target_id) AS rank
  FROM candidates
  WHERE distance <= 0.1
)
INSERT INTO topic_suggestions (topic_id, target_id, similarity)
SELECT topic.id, ranked.target_id,
       CASE WHEN ranked.target_id IS NULL THEN NULL ELSE 1.0 - ranked.distance END
FROM topics topic
LEFT JOIN ranked ON ranked.topic_id = topic.id AND ranked.rank = 1;
