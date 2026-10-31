//! FEATURE cpt-noter-feature-core-history-undo (slice 1): the History read model and the
//! undo/redo commands. The replay itself is `noter_db::Store::reverse` on the single writer;
//! this module validates, assembles `ChangeRow`s and publishes what a reversal moved.

use std::collections::BTreeSet;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params_from_iter, OptionalExtension};
use noter_db::{Direction, Handle};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::settings::{invalid, section_of};
use crate::{lock, object, Core};

const DEFAULT_PAGE: u32 = 100;
const MAX_PAGE: u32 = 500;

/// A `changes` row as selected for History, before its labels are looked up.
struct Raw {
    rowid: i64,
    id: String,
    batch_id: Option<String>,
    batch_size: u32,
    ts: i64,
    actor: String,
    entity_type: String,
    entity_id: String,
    field: Option<String>,
    before: Option<String>,
    after: Option<String>,
    has_delta: bool,
    summary: String,
    reason: String,
    confidence: Option<String>,
    status: String,
    undoable: bool,
    /// The record was deleted for good: its old values must not come back through History.
    gone: bool,
    redoable: bool,
    label: Option<String>,
}

fn unreadable(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::ChangeLogUnreadable, e.to_string())
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-history-undo-read:p1
    pub(crate) fn history_page(&self, args: HistoryListArgs) -> Result<Page<ChangeRow>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-read-request
        self.ready()?;
        if args.from.zip(args.to).is_some_and(|(from, to)| from > to) {
            return Err(invalid("to", ValidationRule::OutOfRange));
        }
        let limit = args.page.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
        let cursor = args
            .page
            .cursor
            .as_ref()
            .map(|c| c.0.parse::<i64>())
            .transpose()
            .map_err(|_| invalid("cursor", ValidationRule::InvalidFormat))?;
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-read-request
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-read-select
        let (filter, mut binds) = filter_of(&args);
        if let Some(cursor) = cursor {
            binds.push(Sql::Integer(cursor));
        }
        let cursor_clause = if cursor.is_some() {
            " AND c.rowid < ?"
        } else {
            ""
        };
        binds.push(Sql::Integer(i64::from(limit) + 1));
        let sql = format!(
            "SELECT c.rowid, c.id, c.batch_id,
                    CASE WHEN c.batch_id IS NULL THEN 1
                         ELSE (SELECT count(*) FROM changes b WHERE b.batch_id = c.batch_id AND b.redo_of IS NULL) END,
                    c.ts, c.actor, c.entity_type, c.entity_id, c.field, c.before, c.after, c.delta IS NOT NULL,
                    c.summary, c.reason, c.confidence, c.status, c.undoable,
                    (EXISTS (SELECT 1 FROM changes d WHERE d.entity_type = c.entity_type AND d.entity_id = c.entity_id
                                AND d.rowid > c.rowid AND d.undoable = 0 AND d.field IS NULL AND d.delta IS NULL)
                     OR (c.entity_type = 'segment' AND NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = c.entity_id))
                     OR (c.entity_type = 'speaker' AND NOT EXISTS (SELECT 1 FROM speakers s WHERE s.id = c.entity_id)))
             FROM changes c WHERE {filter}{cursor_clause} ORDER BY c.rowid DESC LIMIT ?"
        );
        let mut found = self
            .store()
            .read(move |c| {
                let mut stmt = c.prepare(&sql)?;
                let rows = stmt
                    .query_map(params_from_iter(binds), |r| {
                        let id: String = r.get(1)?;
                        let status: String = r.get(15)?;
                        let entity_type: String = r.get(6)?;
                        let entity_id: String = r.get(7)?;
                        let gone: bool = r.get(17)?;
                        Ok(Raw {
                            rowid: r.get(0)?,
                            batch_id: r.get(2)?,
                            batch_size: r.get(3)?,
                            ts: r.get(4)?,
                            actor: r.get(5)?,
                            field: r.get(8)?,
                            before: r.get(9)?,
                            after: r.get(10)?,
                            has_delta: r.get(11)?,
                            summary: r.get(12)?,
                            reason: r.get(13)?,
                            confidence: r.get(14)?,
                            undoable: r.get(16)?,
                            redoable: status == "undone" && noter_db::redoable(c, &id),
                            label: label_of(c, &entity_type, &entity_id, gone),
                            id,
                            status,
                            entity_type,
                            entity_id,
                            gone,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(rows)
            })
            .map_err(|e| unreadable(e.message))?;
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-read-select
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-read-return
        let next_cursor = if found.len() > limit as usize {
            found.truncate(limit as usize);
            found.last().map(|r| Cursor(r.rowid.to_string()))
        } else {
            None
        };
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-read-return
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-read-assemble
        let rows = found
            .into_iter()
            .map(change_row)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Page {
            rows,
            next_cursor,
            total: None,
        })
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-read-assemble
    }

    // @cpt-flow:cpt-noter-flow-core-history-undo-reverse:p1
    pub(crate) fn reverse_change(
        &self,
        dir: Direction,
        target: UndoTarget,
    ) -> Result<UndoResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-request
        self.ready()?;
        let handle = match target {
            UndoTarget::Change { change_id } => Handle::Change(change_id),
            UndoTarget::Batch { batch_id } => Handle::Batch(batch_id),
        };
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-request
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-apply
        let reversed = self.store().reverse(dir, handle, self.deps.clock.now().0)?;
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-apply
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-publish
        if let Err(e) = self.publish_reversed(&reversed.touched) {
            // The change is committed; a window that missed the event catches up on its next read.
            self.log(object(json!({
                "level": "error", "module": "history", "code": "publish", "message_len": e.message.len()
            })));
        }
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-publish
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-return
        Ok(UndoResult {
            undone: reversed.done,
            skipped_edited_later: reversed.skipped,
        })
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-return
    }

    /// Whole changed entities through `entity:changed`, settings through `settings:changed`,
    /// the glossary through its live hooks, transcript files rewritten for transcript changes.
    fn publish_reversed(&self, touched: &[(String, String)]) -> Result<(), CoreError> {
        let mut settings_keys = BTreeSet::new();
        let mut glossary = false;
        let mut transcripts = BTreeSet::new();
        let mut speakers = BTreeSet::new();
        for (kind, id) in touched {
            match kind.as_str() {
                "call" => {
                    if let Some(call) = self.call_row(id)? {
                        self.emit_entity_changed(&EntityChanged::Call { call });
                    }
                }
                "setting" => {
                    settings_keys.insert(id.clone());
                }
                "glossary" => glossary = true,
                "segment" | "speaker" => {
                    let table = if kind == "segment" {
                        "segments"
                    } else {
                        "speakers"
                    };
                    let id = id.clone();
                    let call_id: Option<String> = self.store().read(move |c| {
                        c.query_row(
                            &format!("SELECT call_id FROM {table} WHERE id = ?1"),
                            [id],
                            |r| r.get(0),
                        )
                        .optional()
                    })?;
                    if let Some(call_id) = call_id {
                        if kind == "segment" {
                            transcripts.insert(call_id);
                        } else {
                            speakers.insert(call_id);
                        }
                    }
                }
                _ => {}
            }
        }
        if !settings_keys.is_empty() {
            let mut settings = lock(&self.settings);
            let fresh = crate::settings::load(self.store())?;
            for key in settings_keys {
                let tagged = json!({ "section": key, "value": section_of(&fresh, &key)? });
                let section = serde_json::from_value(tagged).map_err(crate::internal)?;
                self.settings_written(&mut settings, section, fresh.rev);
            }
        }
        if glossary {
            self.glossary_written()?;
        }
        for call_id in transcripts {
            self.write_transcript_file(&CallId::new(call_id))?;
        }
        for call_id in speakers {
            let views = {
                let call_id = call_id.clone();
                self.store()
                    .read(move |c| crate::library::speakers_of(c, &call_id))?
            };
            self.emit_entity_changed(&EntityChanged::Speakers {
                call_id: CallId::new(call_id),
                speakers: views,
            });
        }
        Ok(())
    }
}

/// The WHERE clause and its binds for a target, actor, job and period.
fn filter_of(args: &HistoryListArgs) -> (String, Vec<Sql>) {
    let mut clauses = vec!["1 = 1".to_string()];
    let mut binds: Vec<Sql> = Vec::new();
    let text = |s: &str| Sql::Text(s.to_string());
    match &args.target {
        HistoryTarget::All => {}
        HistoryTarget::Call { call_id } => {
            clauses.push(
                "((c.entity_type = 'call' AND c.entity_id = ?)
                  OR (c.entity_type = 'segment' AND c.entity_id IN (SELECT id FROM segments WHERE call_id = ?))
                  OR (c.entity_type = 'speaker' AND c.entity_id IN (SELECT id FROM speakers WHERE call_id = ?)))"
                    .into(),
            );
            binds.extend(std::iter::repeat_with(|| text(call_id.as_str())).take(3));
        }
        HistoryTarget::Item { item_id } => {
            clauses.push("(c.entity_type = 'item' AND c.entity_id = ?)".into());
            binds.push(text(item_id.as_str()));
        }
        HistoryTarget::Person { person_id } => {
            clauses.push("(c.entity_type = 'person' AND c.entity_id = ?)".into());
            binds.push(text(person_id.as_str()));
        }
    }
    match args.actor {
        ActorFilter::All => {}
        ActorFilter::You => clauses.push("c.actor = 'you'".into()),
        ActorFilter::Jobs => clauses.push("c.actor LIKE 'job:%'".into()),
        ActorFilter::Models => clauses.push("c.actor LIKE 'llm_run:%'".into()),
    }
    if let Some(job) = &args.job_id {
        clauses.push("c.actor = ?".into());
        binds.push(Sql::Text(format!("job:{job}")));
    }
    if let Some(from) = args.from {
        clauses.push("c.ts >= ?".into());
        binds.push(Sql::Integer(from.0));
    }
    if let Some(to) = args.to {
        clauses.push("c.ts <= ?".into());
        binds.push(Sql::Integer(to.0));
    }
    (clauses.join(" AND "), binds)
}

/// What the row's entity is called now; a deleted record keeps no name.
fn label_of(
    c: &noter_db::rusqlite::Connection,
    entity_type: &str,
    id: &str,
    gone: bool,
) -> Option<String> {
    let lookup = |sql: &str| {
        c.query_row(sql, [id], |r| r.get::<_, String>(0))
            .optional()
            .ok()
            .flatten()
    };
    match entity_type {
        "call" => lookup("SELECT title FROM calls WHERE id = ?1")
            .or_else(|| gone.then(|| "Deleted call".to_string())),
        "glossary" => lookup("SELECT term FROM glossary WHERE id = ?1"),
        _ => None,
    }
}

fn change_row(r: Raw) -> Result<ChangeRow, CoreError> {
    let actor = match r.actor.split_once(':') {
        None if r.actor == "you" => Actor::You,
        Some(("job", id)) => Actor::Job {
            job_id: JobId::new(id),
            name: id.to_string(),
        },
        // shortcut: the runtime and model live in `llm_runs` (2.15); until it lands a model's
        // change names the run only.
        Some(("llm_run", id)) => Actor::Model {
            llm_run_id: LlmRunId::new(id),
            runtime: RuntimeChoice::Local,
            model: id.to_string(),
        },
        _ => return Err(unreadable(format!("unknown actor {:?}", r.actor))),
    };
    let kind = match r.entity_type.as_str() {
        "call" => EntityKind::Call,
        "segment" => EntityKind::Segment,
        "speaker" => EntityKind::Speaker,
        "person" => EntityKind::Person,
        "item" => EntityKind::Item,
        "summary" => EntityKind::Summary,
        "topic" => EntityKind::Topic,
        "agent" => EntityKind::Agent,
        "source" => EntityKind::Source,
        "glossary" => EntityKind::Glossary,
        "setting" => EntityKind::Setting,
        "handoff" => EntityKind::Handoff,
        other => return Err(unreadable(format!("unknown entity type {other:?}"))),
    };
    let status = match r.status.as_str() {
        "applied" => ChangeStatus::Applied,
        "proposed" => ChangeStatus::Proposed,
        "rejected" => ChangeStatus::Rejected,
        "undone" => ChangeStatus::Undone,
        other => return Err(unreadable(format!("unknown status {other:?}"))),
    };
    let confidence = match r.confidence.as_deref() {
        Some("high") => Some(ConfidenceLevel::High),
        Some("medium") => Some(ConfidenceLevel::Medium),
        Some("low") => Some(ConfidenceLevel::Low),
        _ => None,
    };
    // Inline diffs are for text fields: a JSON section, a several-column change or a deleted
    // record carries none.
    let text = !(r.gone || r.has_delta || kind == EntityKind::Setting);
    let replayable = noter_db::replayable(&r.entity_type, r.field.as_deref());
    Ok(ChangeRow {
        id: ChangeId::new(r.id),
        batch_id: r.batch_id.map(BatchId::new),
        batch_size: r.batch_size,
        at: TimestampMs(r.ts),
        actor,
        entity: EntityRef {
            kind,
            label: r.label.unwrap_or_else(|| r.entity_id.clone()),
            id: r.entity_id,
        },
        field: r.field,
        before: r.before.filter(|_| text),
        after: r.after.filter(|_| text),
        summary: r.summary,
        reason: Some(r.reason).filter(|s| !s.is_empty()),
        // shortcut: evidence views need the evidence table of 2.17/2.18; the row keeps the ids.
        evidence: Vec::new(),
        confidence,
        status,
        undoable: r.undoable && replayable && status == ChangeStatus::Applied,
        redoable: r.redoable,
    })
}
