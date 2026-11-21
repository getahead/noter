-- Existing turns have no reliable per-turn scope or measurement. Keep those unknown.
ALTER TABLE ask_turns ADD COLUMN scope TEXT;
ALTER TABLE ask_turns ADD COLUMN meta TEXT;
ALTER TABLE ask_turns ADD COLUMN rating TEXT CHECK (rating IN ('helpful', 'not_helpful'));
