ALTER TABLE job_runs ADD COLUMN archive_rerun_rev INTEGER;
ALTER TABLE job_runs ADD COLUMN archive_rerun_committed INTEGER NOT NULL DEFAULT 0;
