//! The Library: the call list, the call record, edits of a call's title and type, the call types
//! and deleting calls for good, over the rows capture writes (`calls`, `segments`, `speakers`,
//! `marks`, `gaps`, `call_tags`).

use std::path::Path;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use noter_db::{Mutation, StoreState};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

use crate::settings::invalid;
use crate::{lock, object, Core};

/// The call types Noter ships (D-25); the ids are the fixture's.
const BUILT_IN_TYPES: [&str; 8] = [
    "one_on_one",
    "standup",
    "planning",
    "retro",
    "cross_team",
    "vendor",
    "interview",
    "incident",
];

/// Capture writes this type for a call nobody classified yet; it is listed on calls and filters
/// but is not a choice (`call_types_list`).
const UNCLASSIFIED: &str = "unclassified";

const DEFAULT_PAGE: u32 = 100;
const MAX_PAGE: u32 = 500;
const DAY_MS: i64 = 86_400_000;

/// Call folders whose files could not be removed after their rows went; retried at the next start.
const PENDING_FILE: &str = "audio/.pending-delete";

/// A `calls` row as stored.
struct Stored {
    id: String,
    rev: u32,
    started_at: i64,
    ended_at: Option<i64>,
    title: String,
    call_type: String,
    platform: Option<String>,
    privacy_class: String,
    status: String,
    outputs_status: String,
    archive_status: String,
    audio_retention_until: Option<i64>,
    audio_deleted: bool,
    audio_not_stored: bool,
    mode_used: String,
}

const STORED: &str = "c.id, c.rev, c.started_at, c.ended_at, c.title, c.call_type, c.platform, \
    c.privacy_class, c.status, c.outputs_status, c.archive_status, c.audio_retention_until, \
    c.audio_deleted, c.audio_not_stored, c.mode_used";

fn stored(r: &Row<'_>) -> noter_db::rusqlite::Result<Stored> {
    Ok(Stored {
        id: r.get(0)?,
        rev: r.get(1)?,
        started_at: r.get(2)?,
        ended_at: r.get(3)?,
        title: r.get(4)?,
        call_type: r.get(5)?,
        platform: r.get(6)?,
        privacy_class: r.get(7)?,
        status: r.get(8)?,
        outputs_status: r.get(9)?,
        archive_status: r.get(10)?,
        audio_retention_until: r.get(11)?,
        audio_deleted: r.get(12)?,
        audio_not_stored: r.get(13)?,
        mode_used: r.get(14)?,
    })
}

/// A stored snake_case word as its protocol enum.
pub(crate) fn word<T: serde::de::DeserializeOwned>(text: String) -> noter_db::rusqlite::Result<T> {
    serde_json::from_value(Value::String(text)).map_err(|e| {
        noter_db::rusqlite::Error::FromSqlConversionFailure(
            0,
            noter_db::rusqlite::types::Type::Text,
            Box::new(e),
        )
    })
}

pub(crate) fn lang_of(code: String) -> Lang {
    match code.as_str() {
        "en" => Lang::En,
        "ru" => Lang::Ru,
        "de" => Lang::De,
        _ => Lang::Other { code },
    }
}

pub(crate) fn lang_code(lang: &Lang) -> String {
    match lang {
        Lang::En => "en".into(),
        Lang::Ru => "ru".into(),
        Lang::De => "de".into(),
        Lang::Other { code } => code.clone(),
    }
}

/// The speakers a call shows: the archive pass once it exists, the live one until then.
pub(crate) const SHOWN_PASS: &str =
    "(CASE WHEN EXISTS (SELECT 1 FROM speakers WHERE call_id = ?1 AND pass = 'archive') \
    THEN 'archive' ELSE 'live' END)";

// @cpt-algo:cpt-noter-algo-core-library-calls-row:p1
fn assemble(c: &Connection, s: Stored, now: i64) -> noter_db::rusqlite::Result<CallRow> {
    // @cpt-begin:cpt-noter-algo-core-library-calls-row:p1:inst-row-derive
    let mut languages = c.prepare(
        "SELECT lang FROM segments WHERE call_id = ?1 AND lang IS NOT NULL
         GROUP BY lang ORDER BY min(t0_ms), lang",
    )?;
    let languages = languages
        .query_map([&s.id], |r| r.get::<_, String>(0).map(lang_of))?
        .collect::<Result<Vec<_>, _>>()?;
    let unnamed_speakers: u32 = c.query_row(
        &format!(
            "SELECT count(*) FROM speakers
             WHERE call_id = ?1 AND person_id IS NULL AND n IS NOT NULL AND pass = {SHOWN_PASS}"
        ),
        [&s.id],
        |r| r.get(0),
    )?;
    let mut tags = c.prepare("SELECT tag FROM call_tags WHERE call_id = ?1 ORDER BY tag_norm")?;
    let tags = tags
        .query_map([&s.id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    // @cpt-end:cpt-noter-algo-core-library-calls-row:p1:inst-row-derive
    // @cpt-begin:cpt-noter-algo-core-library-calls-row:p1:inst-row-fields
    // @cpt-begin:cpt-noter-algo-core-library-calls-row:p1:inst-row-later
    let row = CallRow {
        id: CallId::new(s.id),
        rev: Rev(s.rev),
        title: s.title,
        call_type: CallTypeId(s.call_type),
        started_at: TimestampMs(s.started_at),
        // A call still recording lasts until the clock's now.
        duration_ms: DurationMs(
            (s.ended_at.unwrap_or(now) - s.started_at).clamp(0, u32::MAX.into()) as u32,
        ),
        platform: s.platform,
        participants: vec![],
        unnamed_speakers,
        languages,
        tags,
        privacy: word(s.privacy_class)?,
        status: word(s.status)?,
        outputs: word(s.outputs_status)?,
        archive: word(s.archive_status)?,
        audio_kept_until: s.audio_retention_until.map(TimestampMs),
        audio_deleted: s.audio_deleted,
        open_items: 0,
        review_waiting: 0,
    };
    // @cpt-end:cpt-noter-algo-core-library-calls-row:p1:inst-row-later
    // @cpt-end:cpt-noter-algo-core-library-calls-row:p1:inst-row-fields
    // @cpt-begin:cpt-noter-algo-core-library-calls-row:p1:inst-row-return
    Ok(row)
    // @cpt-end:cpt-noter-algo-core-library-calls-row:p1:inst-row-return
}

fn select_call(c: &Connection, id: &str) -> noter_db::rusqlite::Result<Option<Stored>> {
    c.query_row(
        &format!("SELECT {STORED} FROM calls c WHERE c.id = ?1"),
        [id],
        stored,
    )
    .optional()
}

/// Days since 1970-01-01 of a `YYYY-MM-DD` date; `None` for anything else.
pub(crate) fn day_number(date: &LocalDate) -> Option<i64> {
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
    // Days from civil (Howard Hinnant).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

/// What the list's `WHERE` clause needs, with its bound values (`?1` is the clock's now).
pub(crate) struct Where {
    pub(crate) sql: String,
    pub(crate) params: Vec<Sql>,
}

impl Where {
    pub(crate) fn bind(&mut self, v: impl Into<Sql>) -> String {
        self.params.push(v.into());
        format!("?{}", self.params.len())
    }

    pub(crate) fn bind_all<T: Into<Sql>>(&mut self, values: impl IntoIterator<Item = T>) -> String {
        let marks: Vec<String> = values.into_iter().map(|v| self.bind(v)).collect();
        marks.join(", ")
    }
}

/// How a sort orders the rows: its key expression, whether it runs downward.
fn order_of(sort: CallSort) -> (&'static str, bool) {
    match sort {
        CallSort::Newest => ("c.started_at", true),
        CallSort::Oldest => ("c.started_at", false),
        CallSort::Longest => ("(COALESCE(c.ended_at, ?1) - c.started_at)", true),
        CallSort::Title => ("c.title COLLATE NOCASE", false),
    }
}

/// A page cursor: the last row's sort key and id.
pub(crate) fn cursor_of(key: Value, id: &str) -> Cursor {
    Cursor(json!([key, id]).to_string())
}

pub(crate) fn parse_cursor(c: &Cursor) -> Result<(Sql, String), CoreError> {
    let bad = || invalid("page.cursor", ValidationRule::InvalidFormat);
    let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&c.0) else {
        return Err(bad());
    };
    match parts.as_slice() {
        [Value::Number(n), Value::String(id)] => {
            Ok((Sql::Integer(n.as_i64().ok_or_else(bad)?), id.clone()))
        }
        [Value::String(k), Value::String(id)] => Ok((Sql::Text(k.clone()), id.clone())),
        _ => Err(bad()),
    }
}

impl Core {
    pub(crate) fn ready(&self) -> Result<(), CoreError> {
        if self.store().state() == StoreState::Ready {
            Ok(())
        } else {
            Err(CoreError::new(
                ErrorCode::NotReady,
                "the core is still starting",
            ))
        }
    }

    // @cpt-flow:cpt-noter-flow-core-library-calls-list:p1
    // @cpt-dod:cpt-noter-dod-core-library-calls-read:p1
    pub(crate) fn list_calls(&self, args: CallsListArgs) -> Result<Page<CallRow>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-library-calls-list:p1:inst-list-call
        self.ready()?;
        // @cpt-end:cpt-noter-flow-core-library-calls-list:p1:inst-list-call
        // @cpt-begin:cpt-noter-flow-core-library-calls-list:p1:inst-list-validate
        let now = self.deps.clock.now().0;
        let mut w = Where {
            sql: String::new(),
            params: vec![Sql::Integer(now)],
        };
        // `?1` (the clock's now) is always bound, so every statement must mention it.
        let mut clauses: Vec<String> = vec!["?1 IS NOT NULL".into()];
        let f = &args.filter;
        if !f.call_types.is_empty() {
            let known = self.call_types_now().call_types;
            for t in &f.call_types {
                if t.0 != UNCLASSIFIED && !known.iter().any(|k| k.id == *t) {
                    return Err(invalid("filter.call_types", ValidationRule::InvalidFormat));
                }
            }
            let marks = w.bind_all(f.call_types.iter().map(|t| t.0.clone()));
            clauses.push(format!("c.call_type IN ({marks})"));
        }
        if !f.languages.is_empty() {
            let marks = w.bind_all(f.languages.iter().map(lang_code));
            clauses.push(format!(
                "EXISTS (SELECT 1 FROM segments s WHERE s.call_id = c.id AND s.lang IN ({marks}))"
            ));
        }
        if !f.tags.is_empty() {
            let marks = w.bind_all(f.tags.iter().map(|t| t.to_lowercase()));
            clauses.push(format!(
                "EXISTS (SELECT 1 FROM call_tags t WHERE t.call_id = c.id AND t.tag_norm IN ({marks}))"
            ));
        }
        if !f.people.is_empty() {
            let marks = w.bind_all(f.people.iter().map(|p| p.0.clone()));
            clauses.push(format!(
                "EXISTS (SELECT 1 FROM speakers p WHERE p.call_id = c.id AND p.person_id IN ({marks}))"
            ));
        }
        // shortcut: a day is a UTC day; use the user's time zone when settings carry one.
        let day = |d: &Option<LocalDate>, field: &str| match d {
            None => Ok(None),
            Some(d) => day_number(d)
                .map(Some)
                .ok_or_else(|| invalid(field, ValidationRule::InvalidFormat)),
        };
        let (from, to) = (day(&f.from, "filter.from")?, day(&f.to, "filter.to")?);
        if from.zip(to).is_some_and(|(from, to)| from > to) {
            return Err(invalid("filter.to", ValidationRule::OutOfRange));
        }
        if let Some(from) = from {
            let mark = w.bind(from * DAY_MS);
            clauses.push(format!("c.started_at >= {mark}"));
        }
        if let Some(to) = to {
            let mark = w.bind((to + 1) * DAY_MS);
            clauses.push(format!("c.started_at < {mark}"));
        }
        // Items arrive in M2: no call has open ones yet.
        if f.has_open_items == Some(true) {
            clauses.push("0".into());
        }
        w.sql = clauses.join(" AND ");
        let limit = args.page.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE) as usize;
        let after = args.page.cursor.as_ref().map(parse_cursor).transpose()?;
        // @cpt-end:cpt-noter-flow-core-library-calls-list:p1:inst-list-validate
        let (key, down) = order_of(args.sort);
        self.store().read(|c| {
            // @cpt-begin:cpt-noter-flow-core-library-calls-list:p1:inst-list-select
            let total: u32 = c.query_row(
                &format!("SELECT count(*) FROM calls c WHERE {}", w.sql),
                params_from_iter(w.params.iter()),
                |r| r.get(0),
            )?;
            let mut page = Where {
                sql: w.sql.clone(),
                params: w.params.clone(),
            };
            if let Some((k, id)) = after {
                let (k, id) = (page.bind(k), page.bind(id));
                let op = if down { "<" } else { ">" };
                page.sql = format!(
                    "{} AND ({key} {op} {k} OR ({key} = {k} AND c.id {op} {id}))",
                    page.sql
                );
            }
            let dir = if down { "DESC" } else { "ASC" };
            let sql = format!(
                "SELECT {STORED}, {key} FROM calls c WHERE {} ORDER BY {key} {dir}, c.id {dir} LIMIT {}",
                page.sql,
                limit + 1
            );
            let mut stmt = c.prepare(&sql)?;
            let mut rows = stmt
                .query_map(params_from_iter(page.params.iter()), |r| {
                    Ok((stored(r)?, r.get::<_, Sql>(15)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            // @cpt-end:cpt-noter-flow-core-library-calls-list:p1:inst-list-select
            let more = rows.len() > limit;
            rows.truncate(limit);
            let next_cursor = match (more, rows.last()) {
                (true, Some((s, k))) => Some(cursor_of(
                    match k {
                        Sql::Integer(i) => json!(i),
                        Sql::Text(t) => json!(t),
                        _ => Value::Null,
                    },
                    &s.id,
                )),
                _ => None,
            };
            // @cpt-begin:cpt-noter-flow-core-library-calls-list:p1:inst-list-assemble
            let rows = rows
                .into_iter()
                .map(|(s, _)| assemble(c, s, now))
                .collect::<Result<Vec<_>, _>>()?;
            // @cpt-end:cpt-noter-flow-core-library-calls-list:p1:inst-list-assemble
            // @cpt-begin:cpt-noter-flow-core-library-calls-list:p1:inst-list-return
            Ok(Page {
                rows,
                next_cursor,
                total: Some(total),
            })
            // @cpt-end:cpt-noter-flow-core-library-calls-list:p1:inst-list-return
        })
    }

    // @cpt-flow:cpt-noter-flow-core-library-calls-get:p1
    pub(crate) fn get_call(&self, args: CallIdArgs) -> Result<CallDetail, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-library-calls-get:p1:inst-get-call
        self.ready()?;
        let now = self.deps.clock.now().0;
        let id = args.call_id.0;
        let folder = self.audio_dir.join(&id).display().to_string();
        // @cpt-end:cpt-noter-flow-core-library-calls-get:p1:inst-get-call
        let found = self.store().read(|c| {
            // @cpt-begin:cpt-noter-flow-core-library-calls-get:p1:inst-get-select
            let Some(s) = select_call(c, &id)? else {
                return Ok(None);
            };
            let (mode_used, audio_not_stored) = (word(s.mode_used.clone())?, s.audio_not_stored);
            let call = assemble(c, s, now)?;
            let speakers = speakers_of(c, &id)?;
            let marks = c
                .prepare("SELECT id, at_ms, note FROM marks WHERE call_id = ?1 ORDER BY at_ms, id")?
                .query_map([&id], |r| {
                    Ok(MarkView {
                        id: MarkId::new(r.get::<_, String>(0)?),
                        call_id: CallId::new(&id),
                        at_ms: OffsetMs(r.get(1)?),
                        note: r.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let gaps = c
                .prepare("SELECT t0_ms, t1_ms, reason FROM gaps WHERE call_id = ?1 ORDER BY t0_ms")?
                .query_map([&id], |r| {
                    Ok(GapView {
                        call_id: CallId::new(&id),
                        t0_ms: OffsetMs(r.get(0)?),
                        t1_ms: OffsetMs(r.get(1)?),
                        reason: word(r.get::<_, String>(2)?)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            // shortcut: "the only call so far" stands for the first recorded call; a stored flag
            // replaces it with the notifications feature (M2).
            let calls: u32 = c.query_row("SELECT count(*) FROM calls", [], |r| r.get(0))?;
            Ok(Some(CallDetail {
                call,
                // Calendar events are read by the calendar feature (M2).
                calendar_event: None,
                speakers,
                marks,
                gaps,
                mode_used,
                audio_not_stored,
                first_recorded_call: calls == 1,
                folder,
            }))
            // @cpt-end:cpt-noter-flow-core-library-calls-get:p1:inst-get-select
        })?;
        // @cpt-begin:cpt-noter-flow-core-library-calls-get:p1:inst-get-missing
        // @cpt-begin:cpt-noter-flow-core-library-calls-get:p1:inst-get-return
        found.ok_or_else(|| CoreError::new(ErrorCode::NotFound, "this call no longer exists"))
        // @cpt-end:cpt-noter-flow-core-library-calls-get:p1:inst-get-return
        // @cpt-end:cpt-noter-flow-core-library-calls-get:p1:inst-get-missing
    }

    // @cpt-flow:cpt-noter-flow-core-library-calls-update:p1
    // @cpt-dod:cpt-noter-dod-core-library-calls-edit:p1
    pub(crate) fn update_call(
        &self,
        ctx: &CommandCtx,
        args: CallUpdateArgs,
    ) -> Result<CallMutation, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-call
        self.ready()?;
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-call
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-validate
        let mut values: Vec<(&'static str, Value)> = vec![];
        if let Some(title) = &args.title {
            let title = title.trim();
            if title.is_empty() {
                return Err(invalid("title", ValidationRule::Required));
            }
            values.push(("title", json!(title)));
        }
        if let Some(kind) = &args.call_type {
            if !self
                .call_types_now()
                .call_types
                .iter()
                .any(|t| t.id == *kind)
            {
                return Err(invalid("call_type", ValidationRule::InvalidFormat));
            }
            values.push(("call_type", json!(kind.0.as_str())));
        }
        if values.is_empty() {
            return Err(invalid("title", ValidationRule::Required));
        }
        let id = args.call_id.0;
        // The write path inserts a row it does not find, so a missing call is refused first.
        let exists = self
            .store()
            .read(|c| select_call(c, &id).map(|s| s.is_some()))?;
        if !exists {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                "this call no longer exists",
            ));
        }
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-validate
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-write
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-conflict
        let written = self.store().write(
            Mutation {
                entity_type: "call",
                table: "calls",
                id: id.clone(),
                base_rev: Some(args.rev),
                bump_rev: true,
                values,
            },
            self.change_meta(ctx, "Changed call info".into(), "call_update"),
        )?;
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-conflict
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-write
        let now = self.deps.clock.now().0;
        let call = self
            .store()
            .read(|c| {
                select_call(c, &id)?
                    .map(|s| assemble(c, s, now))
                    .transpose()
            })?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "this call no longer exists"))?;
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-emit
        self.emit_entity_changed(&EntityChanged::Call { call: call.clone() });
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-emit
        // @cpt-begin:cpt-noter-flow-core-library-calls-update:p1:inst-update-return
        Ok(CallMutation {
            call,
            change_id: written.change_id,
        })
        // @cpt-end:cpt-noter-flow-core-library-calls-update:p1:inst-update-return
    }

    /// The call as the Library shows it, `None` when it is gone.
    pub(crate) fn call_row(&self, id: &str) -> Result<Option<CallRow>, CoreError> {
        let now = self.deps.clock.now().0;
        self.store()
            .read(|c| select_call(c, id)?.map(|s| assemble(c, s, now)).transpose())
    }

    // @cpt-flow:cpt-noter-flow-core-library-calls-types:p2
    pub(crate) fn call_types_now(&self) -> CallTypeList {
        // @cpt-begin:cpt-noter-flow-core-library-calls-types:p2:inst-types-call
        // @cpt-begin:cpt-noter-flow-core-library-calls-types:p2:inst-types-read
        let mut call_types: Vec<CallTypeInfo> = BUILT_IN_TYPES
            .iter()
            .map(|id| CallTypeInfo {
                id: CallTypeId((*id).into()),
                label: id.replace('_', " "),
                builtin: true,
                skill_path: format!("skills/{id}/SKILL.md"),
            })
            .collect();
        let skills = self.data_dir.join("skills");
        let mut user: Vec<_> = std::fs::read_dir(&skills)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| {
                plain_id(n)
                    && n != UNCLASSIFIED
                    && !BUILT_IN_TYPES.contains(&n.as_str())
                    && n.bytes().all(|b| !b.is_ascii_uppercase())
            })
            .collect();
        user.sort();
        for id in user {
            let file = skills.join(&id).join("SKILL.md");
            // An unreadable folder is left out and logged; the built-in list is always returned.
            if std::fs::read(&file).is_err() {
                self.log(object(
                    json!({ "level": "warn", "module": "library", "code": "skill_unreadable" }),
                ));
                continue;
            }
            call_types.push(CallTypeInfo {
                label: id.replace('_', " "),
                id: CallTypeId(id),
                builtin: false,
                skill_path: file.to_string_lossy().into_owned(),
            });
        }
        // @cpt-end:cpt-noter-flow-core-library-calls-types:p2:inst-types-read
        // @cpt-begin:cpt-noter-flow-core-library-calls-types:p2:inst-types-return
        CallTypeList { call_types }
        // @cpt-end:cpt-noter-flow-core-library-calls-types:p2:inst-types-return
        // @cpt-end:cpt-noter-flow-core-library-calls-types:p2:inst-types-call
    }

    // @cpt-flow:cpt-noter-flow-core-library-calls-delete:p1
    // @cpt-dod:cpt-noter-dod-core-library-calls-delete:p1
    pub(crate) fn delete_calls(
        &self,
        ctx: &CommandCtx,
        args: CallsDeleteArgs,
    ) -> Result<DeleteResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-call
        self.ready()?;
        let mut ids: Vec<String> = args.call_ids.into_iter().map(|id| id.0).collect();
        ids.sort();
        ids.dedup();
        // @cpt-end:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-call
        // @cpt-begin:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-live
        {
            let app = lock(&self.app);
            let live = matches!(
                app.capture.phase,
                CapturePhase::Starting
                    | CapturePhase::Recording
                    | CapturePhase::Paused
                    | CapturePhase::Failed
            );
            if live
                && app
                    .capture
                    .call_id
                    .as_ref()
                    .is_some_and(|c| ids.contains(&c.0))
            {
                return Err(CoreError::new(
                    ErrorCode::AlreadyRecording,
                    "a call being recorded cannot be deleted; stop it first",
                ));
            }
        }
        // @cpt-end:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-live
        // @cpt-begin:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-run
        // @cpt-begin:cpt-noter-algo-core-library-calls-delete:p1:inst-del-for
        // @cpt-begin:cpt-noter-algo-core-library-calls-delete:p1:inst-del-tx
        let deleted = self.store().delete(
            "call",
            "calls",
            ids,
            self.change_meta(ctx, "Deleted a call".into(), "calls_delete"),
        )?;
        // @cpt-end:cpt-noter-algo-core-library-calls-delete:p1:inst-del-tx
        for (id, _) in &deleted {
            // @cpt-begin:cpt-noter-algo-core-library-calls-delete:p1:inst-del-files
            // @cpt-begin:cpt-noter-algo-core-library-calls-delete:p1:inst-del-catch
            if !remove_call_files(&self.data_dir, id) {
                self.log(object(
                    json!({ "level": "warn", "module": "library", "code": "audio_not_removed", "id": id }),
                ));
                note_pending(&self.data_dir, id);
            }
            // @cpt-end:cpt-noter-algo-core-library-calls-delete:p1:inst-del-catch
            // @cpt-end:cpt-noter-algo-core-library-calls-delete:p1:inst-del-files
        }
        // @cpt-end:cpt-noter-algo-core-library-calls-delete:p1:inst-del-for
        // @cpt-end:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-run
        // @cpt-begin:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-emit
        for (id, _) in &deleted {
            self.emit_entity_changed(&EntityChanged::Removed {
                kind: EntityKind::Call,
                id: id.clone(),
            });
        }
        // @cpt-end:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-emit
        // @cpt-begin:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-return
        // @cpt-begin:cpt-noter-algo-core-library-calls-delete:p1:inst-del-return
        Ok(DeleteResult {
            deleted: deleted.len() as u32,
        })
        // @cpt-end:cpt-noter-algo-core-library-calls-delete:p1:inst-del-return
        // @cpt-end:cpt-noter-flow-core-library-calls-delete:p1:inst-delete-return
    }

    /// Removes the call folders an earlier delete could not remove (their rows are long gone).
    pub(crate) fn retry_audio_removals(&self) {
        let file = self.data_dir.join(PENDING_FILE);
        let Ok(text) = std::fs::read_to_string(&file) else {
            return;
        };
        let left: Vec<&str> = text
            .lines()
            .filter(|id| !id.is_empty() && !remove_call_files(&self.data_dir, id))
            .collect();
        let _ = if left.is_empty() {
            std::fs::remove_file(&file)
        } else {
            std::fs::write(&file, left.join("\n") + "\n")
        };
    }
}

/// Call ids come from stored rows, but they are spliced into a path: only plain ones.
fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Removes `audio/<call_id>/`; `true` when it is gone (or never was).
fn remove_call_files(data_dir: &Path, id: &str) -> bool {
    if !plain_id(id) {
        return true;
    }
    let dir = data_dir.join("audio").join(id);
    match std::fs::symlink_metadata(&dir) {
        Err(e) => e.kind() == std::io::ErrorKind::NotFound,
        Ok(_) => std::fs::remove_dir_all(&dir).is_ok(),
    }
}

fn note_pending(data_dir: &Path, id: &str) {
    use std::io::Write;
    let _ = std::fs::create_dir_all(data_dir.join("audio"));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data_dir.join(PENDING_FILE))
    {
        let _ = writeln!(f, "{id}");
    }
}

/// The speakers of a call as the call record shows them.
pub(crate) fn speakers_of(
    c: &Connection,
    call_id: &str,
) -> noter_db::rusqlite::Result<Vec<SpeakerView>> {
    let mut stmt = c.prepare(&format!(
        "SELECT s.id, s.label, s.n, s.channel, s.person_id, s.named_by,
                (SELECT count(*) FROM segments g WHERE g.speaker_id = s.id)
         FROM speakers s WHERE s.call_id = ?1 AND s.pass = {SHOWN_PASS} ORDER BY s.rowid"
    ))?;
    let rows = stmt
        .query_map([call_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<u16>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, u32>(6)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, label, n, channel, person, named_by, segment_count)| {
            let you = label == "you";
            let sample = if you {
                None
            } else {
                c.query_row(
                    "SELECT t0_ms, t1_ms FROM segments WHERE speaker_id = ?1 ORDER BY t0_ms LIMIT 1",
                    params![id],
                    |r| {
                        Ok(TimeSpan {
                            call_id: CallId::new(call_id),
                            channel: None,
                            t0_ms: OffsetMs(r.get(0)?),
                            t1_ms: OffsetMs(r.get(1)?),
                        })
                    },
                )
                .optional()?
            };
            Ok(SpeakerView {
                label: if you {
                    SpeakerLabel::You
                } else if label == "guest_your_side" {
                    SpeakerLabel::GuestYourSide
                } else if let Some(person) = person {
                    SpeakerLabel::Person {
                        person: chip(person, label),
                    }
                } else {
                    SpeakerLabel::Unnamed { n: n.unwrap_or(0) }
                },
                id: SpeakerId::new(id),
                call_id: CallId::new(call_id),
                channel: word(channel)?,
                segment_count,
                talk_ms: None,
                sample,
                // Voice profiles and the calendar suggest names from M2.
                suggestion: None,
                named_by: named_by.map(word).transpose()?,
            })
        })
        .collect()
}

/// A named speaker's chip. shortcut: no `people` table before library-people (M2), so the chip
/// is made from the stored name; that feature reads the person's own record.
fn chip(person_id: String, name: String) -> PersonChip {
    let words: Vec<&str> = name.split_whitespace().collect();
    PersonChip {
        id: PersonId::new(person_id),
        short_name: match words.as_slice() {
            [first, .., last] => format!("{first} {}.", last.chars().next().unwrap_or_default()),
            _ => name.clone(),
        },
        initials: words
            .iter()
            .filter_map(|w| w.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase(),
        display_name: name,
        is_you: false,
    }
}
