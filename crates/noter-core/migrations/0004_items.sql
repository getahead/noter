-- Items and their evidence spans (DESIGN-core cpt-noter-dbtable-items, -item-spans).
-- shortcut: no FKs to people, topics or evidence until those tables land (library-people, M3, M5).
CREATE TABLE items (
  id                    TEXT PRIMARY KEY,
  rev                   INTEGER NOT NULL,
  call_id               TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  kind                  TEXT NOT NULL CHECK (kind IN ('decision', 'action_item', 'open_question', 'risk')),
  text                  TEXT NOT NULL,
  lang                  TEXT NOT NULL,
  -- The generated wording, kept once the text is edited, for the diff on accept.
  generated_text        TEXT,
  owner_person_id       TEXT,
  due_date              TEXT,
  status                TEXT NOT NULL CHECK (status IN
                          ('open', 'done', 'carried', 'handed_off', 'closed_by_evidence', 'answered_in_call')),
  review_state          TEXT NOT NULL CHECK (review_state IN ('suggested', 'accepted', 'rejected')),
  created_by            TEXT NOT NULL CHECK (created_by IN ('llm', 'user', 'pin')),
  topic_id              TEXT,
  is_engineering        INTEGER NOT NULL DEFAULT 0 CHECK (is_engineering IN (0, 1)),
  linked_issue_key      TEXT,
  handoff_target        TEXT,
  handoff_cwd           TEXT,
  handed_off_at         INTEGER,
  closed_by_evidence_id TEXT,
  done_at               INTEGER,
  carried_from_call_id  TEXT REFERENCES calls (id) ON DELETE SET NULL
);
CREATE INDEX items_call ON items (call_id);
CREATE INDEX items_status ON items (status, review_state);

CREATE TABLE item_spans (
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  call_id TEXT NOT NULL REFERENCES calls (id) ON DELETE CASCADE,
  -- Both channels when NULL.
  channel TEXT CHECK (channel IN ('mic', 'sys')),
  t0_ms   INTEGER NOT NULL,
  t1_ms   INTEGER NOT NULL,
  PRIMARY KEY (item_id, call_id, t0_ms)
);
