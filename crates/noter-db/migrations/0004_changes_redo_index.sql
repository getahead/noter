CREATE INDEX changes_redo_of ON changes (redo_of) WHERE redo_of IS NOT NULL;
