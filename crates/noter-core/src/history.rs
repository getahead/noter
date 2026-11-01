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
use crate::{lock, object, Core, SaveKind};

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
        let sql = select_sql(
            &format!("{filter}{cursor_clause}"),
            "ORDER BY c.rowid DESC LIMIT ?",
        );
        let mut found = self
            .store()
            .read(move |c| raw_rows(c, &sql, binds))
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
    // @cpt-dod:cpt-noter-dod-core-history-undo-reversal:p1
    pub(crate) fn reverse_change(
        &self,
        dir: Direction,
        target: UndoTarget,
    ) -> Result<UndoResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-request
        self.ready()?;
        let noted = target.clone();
        let handle = match target {
            UndoTarget::Change { change_id } => Handle::Change(change_id),
            UndoTarget::Batch { batch_id } => Handle::Batch(batch_id),
        };
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-request
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-apply
        // Items an undone creation removes cannot be found afterwards: note their calls first.
        let item_calls = self
            .store()
            .read(move |c| crate::items::calls_of_target(c, &noted))?;
        let reversed = self.store().reverse(dir, handle, self.deps.clock.now().0)?;
        // @cpt-end:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-apply
        // @cpt-begin:cpt-noter-flow-core-history-undo-reverse:p1:inst-reverse-publish
        if let Err(e) = self.publish_reversed(&reversed.touched, item_calls) {
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
    fn publish_reversed(
        &self,
        touched: &[(String, String)],
        mut item_calls: BTreeSet<String>,
    ) -> Result<(), CoreError> {
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
                // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-undo
                "item" => {
                    if let Some(item) = self.item_view(id)? {
                        item_calls.insert(item.call.id.as_str().to_string());
                        self.emit_entity_changed(&EntityChanged::Item { item });
                    }
                }
                // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-undo
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
        self.items_files(item_calls);
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

/// The History select over `filter`, then `tail` (order, limit).
fn select_sql(filter: &str, tail: &str) -> String {
    format!(
        "SELECT c.rowid, c.id, c.batch_id,
                CASE WHEN c.batch_id IS NULL THEN 1
                     ELSE (SELECT count(*) FROM changes b WHERE b.batch_id = c.batch_id AND b.redo_of IS NULL) END,
                c.ts, c.actor, c.entity_type, c.entity_id, c.field, c.before, c.after, c.delta IS NOT NULL,
                c.summary, c.reason, c.confidence, c.status, c.undoable,
                (EXISTS (SELECT 1 FROM changes d WHERE d.entity_type = c.entity_type AND d.entity_id = c.entity_id
                            AND d.rowid > c.rowid AND d.undoable = 0 AND d.field IS NULL AND d.delta IS NULL)
                 OR (c.entity_type = 'segment' AND NOT EXISTS (SELECT 1 FROM segments s WHERE s.id = c.entity_id))
                 OR (c.entity_type = 'speaker' AND NOT EXISTS (SELECT 1 FROM speakers s WHERE s.id = c.entity_id)))
         FROM changes c WHERE {filter} {tail}"
    )
}

fn raw_rows(
    c: &noter_db::rusqlite::Connection,
    sql: &str,
    binds: Vec<Sql>,
) -> noter_db::rusqlite::Result<Vec<Raw>> {
    let mut stmt = c.prepare(sql)?;
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
}

/// The WHERE clause and its binds for a target, actor, job and period.
fn filter_of(args: &HistoryListArgs) -> (String, Vec<Sql>) {
    // The model's `llm_runs`/`audit_log` bookkeeping (2.15) is not a user-facing entity: no
    // `EntityKind` names it, so it is out of History even under the model filter.
    let mut clauses = vec!["c.entity_type NOT IN ('llm_run', 'audit_log')".to_string()];
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

const DAY_MS: i64 = 86_400_000;

/// Days since 1970-01-01 of a `YYYY-MM-DD` date; `None` for anything else.
fn day_number(date: &LocalDate) -> Option<i64> {
    let mut parts = date.0.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (y.parse().ok()?, m.parse().ok()?, d.parse().ok()?);
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let last = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return None,
    };
    if !(1..=last).contains(&d) {
        return None;
    }
    Some(days_from_civil(y, m, d))
}

/// Howard Hinnant's days-from-civil.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `YYYY-MM-DD` of a day number (the inverse of [`days_from_civil`]).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

fn date_of(ms: i64) -> String {
    let (y, m, d) = civil_from_days(ms.div_euclid(DAY_MS));
    format!("{y:04}-{m:02}-{d:02}")
}

/// What an export scope selects: a target and a closed period in ms.
struct Selection {
    target: HistoryTarget,
    from: Option<i64>,
    to: Option<i64>,
    /// The part of the suggested file name that says which scope.
    name: String,
}

impl Core {
    // @cpt-dod:cpt-noter-dod-core-history-undo-history:p1
    pub(crate) async fn export_history(
        &self,
        args: HistoryExportArgs,
    ) -> Result<ExportResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-export-request
        self.ready()?;
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-export-request
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-export-panel
        let selection = self.selection_of(&args.scope)?;
        let (ext, kind) = match args.format {
            LogFormat::Markdown => ("md", SaveKind::Markdown),
            LogFormat::Json => ("json", SaveKind::Json),
        };
        let name = format!("noter-history-{}.{ext}", selection.name);
        let panel = self.deps.native_ops.save_panel(&name, kind).await;
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-export-panel
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-export-cancel
        let Some(path) = panel else {
            return Err(CoreError::new(ErrorCode::Cancelled, "export cancelled"));
        };
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-export-cancel
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-export-write
        let list = HistoryListArgs {
            target: selection.target,
            actor: ActorFilter::All,
            job_id: None,
            from: selection.from.map(TimestampMs),
            to: selection.to.map(TimestampMs),
            page: PageRequest {
                cursor: None,
                limit: None,
            },
        };
        let (filter, binds) = filter_of(&list);
        let sql = select_sql(&filter, "ORDER BY c.rowid ASC");
        // One statement on a read connection: the rows are one snapshot.
        let raw = self
            .store()
            .read(move |c| raw_rows(c, &sql, binds))
            .map_err(|e| unreadable(e.message))?;
        let rows = raw
            .into_iter()
            .map(change_row)
            .collect::<Result<Vec<_>, _>>()?;
        let text = match args.format {
            LogFormat::Json => serde_json::to_string_pretty(&rows).map_err(crate::internal)?,
            LogFormat::Markdown => markdown_of(&selection.name, &rows),
        };
        write_file(&path, &text)?;
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-export-write
        // @cpt-begin:cpt-noter-flow-core-history-undo-read:p1:inst-export-result
        Ok(ExportResult {
            path: path.display().to_string(),
            files: 1,
        })
        // @cpt-end:cpt-noter-flow-core-history-undo-read:p1:inst-export-result
    }

    /// shortcut: a day is a UTC day (as in the calls list); use the user's time zone when
    /// settings carry one.
    fn selection_of(&self, scope: &LogScope) -> Result<Selection, CoreError> {
        let today = self.deps.clock.now().0.div_euclid(DAY_MS);
        let period = |first: i64, last: i64, name: String| Selection {
            target: HistoryTarget::All,
            from: Some(first * DAY_MS),
            to: Some((last + 1) * DAY_MS - 1),
            name,
        };
        Ok(match scope {
            LogScope::Call { call_id } => {
                let id = call_id.as_str().to_string();
                let known = self
                    .store()
                    .read(move |c| {
                        c.query_row("SELECT 1 FROM calls WHERE id = ?1", [id], |_| Ok(()))
                            .optional()
                    })?
                    .is_some();
                if !known {
                    return Err(CoreError::new(ErrorCode::NotFound, "no such call"));
                }
                Selection {
                    target: HistoryTarget::Call {
                        call_id: call_id.clone(),
                    },
                    from: None,
                    to: None,
                    name: format!("call-{call_id}"),
                }
            }
            LogScope::Today => period(today, today, date_of(today * DAY_MS)),
            LogScope::Last7Days => period(today - 6, today, "last-7-days".into()),
            LogScope::Last30Days => period(today - 29, today, "last-30-days".into()),
            LogScope::Period { from, to } => {
                let day = |d: &LocalDate, field| {
                    day_number(d).ok_or_else(|| invalid(field, ValidationRule::InvalidFormat))
                };
                let (a, b) = (day(from, "scope.from")?, day(to, "scope.to")?);
                if a > b {
                    return Err(invalid("scope.to", ValidationRule::OutOfRange));
                }
                period(a, b, format!("{}-to-{}", from.0, to.0))
            }
        })
    }
}

/// One plain-language line per change, oldest first.
fn markdown_of(scope: &str, rows: &[ChangeRow]) -> String {
    let mut out = format!("# Noter history: {scope}\n\n");
    for r in rows {
        let ms = r.at.0;
        let (h, m) = (
            ms.rem_euclid(DAY_MS) / 3_600_000,
            ms.rem_euclid(3_600_000) / 60_000,
        );
        let who = match &r.actor {
            Actor::You => "You".to_string(),
            Actor::Job { name, .. } => format!("Job {name}"),
            Actor::Model { model, .. } => format!("Model {model}"),
        };
        out.push_str(&format!(
            "- {} {h:02}:{m:02} · {who} · {}: {}",
            date_of(ms),
            r.summary,
            r.entity.label
        ));
        if let (Some(before), Some(after)) = (&r.before, &r.after) {
            out.push_str(&format!(" (“{before}” → “{after}”)"));
        }
        if r.status == ChangeStatus::Undone {
            out.push_str(" [undone]");
        }
        out.push('\n');
    }
    out
}

/// Complete or absent: written beside the target, then renamed over it.
fn write_file(path: &std::path::Path, text: &str) -> Result<(), CoreError> {
    let tmp = path.with_extension("noter-tmp");
    std::fs::write(&tmp, text)
        .and_then(|()| std::fs::rename(&tmp, path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            CoreError::new(ErrorCode::Internal, format!("cannot write the export: {e}"))
        })
}
