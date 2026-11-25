-- Preserve the distinction even when a user deliberately calls a recording “Untitled call”.
ALTER TABLE calls ADD COLUMN title_pending INTEGER NOT NULL DEFAULT 0 CHECK (title_pending IN (0, 1));
ALTER TABLE call_participants ADD COLUMN from_invite INTEGER NOT NULL DEFAULT 0 CHECK (from_invite IN (0, 1));

-- Repair the old automatic titles when the creation record identifies their origin.
-- An explicit rename (including a later redo) takes precedence.
UPDATE calls SET title = 'Untitled call', title_pending = 1
WHERE calendar_event_id IS NULL AND (title = platform OR title = 'Untitled call')
  AND EXISTS (SELECT 1 FROM changes h WHERE h.entity_type = 'call' AND h.entity_id = calls.id
              AND h.reason = 'Started recording' AND (h.field = 'title' OR json_extract(CAST(h.delta AS TEXT), '$.title') IS NOT NULL))
  AND NOT EXISTS (SELECT 1 FROM changes h WHERE h.entity_type = 'call' AND h.entity_id = calls.id
                  AND h.reason = 'call_update' AND (h.field = 'title' OR json_extract(CAST(h.delta AS TEXT), '$.title') IS NOT NULL));

CREATE VIEW call_attendance AS
SELECT cp.*, cp.from_invite AND NOT EXISTS (
  SELECT 1 FROM speakers s WHERE s.call_id = cp.call_id AND s.person_id = cp.person_id
    AND s.named_by IN ('you', 'voice_profile')
) AS invited_only
FROM call_participants cp;
