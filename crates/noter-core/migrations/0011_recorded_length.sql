-- The length a stopped call recorded (pauses excluded), written at Stop; NULL for calls stopped before
-- it existed, whose length stays end minus start.
ALTER TABLE calls ADD COLUMN recorded_ms INTEGER;
