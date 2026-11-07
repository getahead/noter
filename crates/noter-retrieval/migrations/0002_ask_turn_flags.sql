-- The answer flags `AskAnswer` carries that DESIGN-core's `ask_turns` list has no column for
-- (`answered_locally` is the stored `runtime`).
ALTER TABLE ask_turns ADD COLUMN sensitive_skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ask_turns ADD COLUMN keyword_only INTEGER NOT NULL DEFAULT 0 CHECK (keyword_only IN (0, 1));
ALTER TABLE ask_turns ADD COLUMN only_weak INTEGER NOT NULL DEFAULT 0 CHECK (only_weak IN (0, 1));
