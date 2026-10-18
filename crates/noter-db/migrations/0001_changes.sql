-- The change log (DESIGN-core 3.7, table `changes`): every write commits its row here in the same transaction.
CREATE TABLE changes (
  id            TEXT PRIMARY KEY,
  ts            INTEGER NOT NULL,
  actor         TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  field         TEXT,
  before        TEXT,
  after         TEXT,
  delta         BLOB,
  summary       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  evidence_ids  TEXT NOT NULL DEFAULT '[]',
  confidence    TEXT,
  status        TEXT NOT NULL CHECK (status IN ('applied', 'proposed', 'rejected', 'undone')),
  batch_id      TEXT,
  proposal_kind TEXT,
  undoable      INTEGER NOT NULL DEFAULT 1,
  redo_of       TEXT
);
CREATE INDEX changes_entity ON changes (entity_type, entity_id, ts);
CREATE INDEX changes_batch ON changes (batch_id);
CREATE INDEX changes_status ON changes (status);

-- Append-only: a change to a change is a new row; only `status` may move (undo, proposals).
CREATE TRIGGER changes_append_only
BEFORE UPDATE OF id, ts, actor, entity_type, entity_id, field, before, after, delta, summary, reason,
                 evidence_ids, confidence, batch_id, proposal_kind, undoable, redo_of ON changes
BEGIN SELECT RAISE(ABORT, 'changes is append-only'); END;
CREATE TRIGGER changes_no_delete BEFORE DELETE ON changes
BEGIN SELECT RAISE(ABORT, 'changes is append-only'); END;
