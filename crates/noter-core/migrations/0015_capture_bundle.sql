-- Preserve a detected recording's system-audio scope through interrupted recovery.
ALTER TABLE calls ADD COLUMN capture_bundle_id TEXT;
