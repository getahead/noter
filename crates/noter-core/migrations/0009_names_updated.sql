ALTER TABLE summaries ADD COLUMN names_updated INTEGER NOT NULL DEFAULT 0 CHECK (names_updated IN (0, 1));
