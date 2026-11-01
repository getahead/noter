-- When the audio of a call was deleted (by hand or by age); NULL while it is kept or was never
-- stored. `audio_deleted` stays the flag the readers use.
ALTER TABLE calls ADD COLUMN audio_deleted_at INTEGER;
