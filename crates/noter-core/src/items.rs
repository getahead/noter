//! FEATURE cpt-noter-feature-core-items-today (slice 1): the items service. Reads join owners,
//! calls and spans in the core; every intent is one logged change under a `rev` guard.

use std::collections::BTreeSet;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params_from_iter, Connection, OptionalExtension, Row};
use noter_db::{Logged, Mutation};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde::Serialize;
use serde_json::{json, Value};

use crate::library::{cursor_of, day_number, lang_code, lang_of, parse_cursor, word, Where};
use crate::settings::invalid;
use crate::transcript::segments_of;
use crate::{internal, object, Core};

const DEFAULT_PAGE: u32 = 100;
const MAX_PAGE: u32 = 500;
const MAX_TEXT: usize = 1000;

/// An item row with its call, before owners, spans and the carried-from call are joined.
struct Stored {
    id: String,
    rev: u32,
    call: CallRef,
    kind: String,
    text: String,
    lang: String,
    generated_text: Option<String>,
    owner: Option<String>,
    due: Option<String>,
    status: String,
    review: String,
    created_by: String,
    engineering: bool,
    issue: Option<String>,
    handoff_target: Option<String>,
    handoff_cwd: Option<String>,
    handed_off_at: Option<i64>,
    done_at: Option<i64>,
    carried_from: Option<String>,
}

const COLUMNS: &str = "i.id, i.rev, i.call_id, c.title, c.started_at, c.call_type, i.kind, i.text, i.lang,
    i.generated_text, i.owner_person_id, i.due_date, i.status, i.review_state, i.created_by,
    i.is_engineering, i.linked_issue_key, i.handoff_target, i.handoff_cwd, i.handed_off_at, i.done_at,
    i.carried_from_call_id";

fn stored(r: &Row<'_>) -> noter_db::rusqlite::Result<Stored> {
    Ok(Stored {
        id: r.get(0)?,
        rev: r.get(1)?,
        call: CallRef {
            id: CallId::new(r.get::<_, String>(2)?),
            title: r.get(3)?,
            started_at: TimestampMs(r.get(4)?),
            call_type: CallTypeId(r.get(5)?),
        },
        kind: r.get(6)?,
        text: r.get(7)?,
        lang: r.get(8)?,
        generated_text: r.get(9)?,
        owner: r.get(10)?,
        due: r.get(11)?,
        status: r.get(12)?,
        review: r.get(13)?,
        created_by: r.get(14)?,
        engineering: r.get(15)?,
        issue: r.get(16)?,
        handoff_target: r.get(17)?,
        handoff_cwd: r.get(18)?,
        handed_off_at: r.get(19)?,
        done_at: r.get(20)?,
        carried_from: r.get(21)?,
    })
}

type Db<T> = noter_db::rusqlite::Result<T>;

fn select_item(c: &Connection, id: &str) -> Db<Option<Stored>> {
    c.query_row(
        &format!("SELECT {COLUMNS} FROM items i JOIN calls c ON c.id = i.call_id WHERE i.id = ?1"),
        [id],
        stored,
    )
    .optional()
}

/// The snake_case word of a protocol enum, as stored.
fn name<T: Serialize>(v: &T) -> String {
    match serde_json::to_value(v) {
        Ok(Value::String(s)) => s,
        _ => String::new(),
    }
}

fn sql_of(v: &Value) -> Sql {
    match v {
        Value::Null => Sql::Null,
        Value::Bool(b) => Sql::Integer((*b).into()),
        Value::Number(n) => Sql::Integer(n.as_i64().unwrap_or_default()),
        Value::String(s) => Sql::Text(s.clone()),
        other => Sql::Text(other.to_string()),
    }
}

/// A named speaker's chip: shortcut, no `people` table before library-people, so the name is
/// the label the person's speaker row carries and nobody is the user yet.
fn owner_chip(c: &Connection, person_id: &str) -> Db<PersonChip> {
    let label: Option<String> = c
        .query_row(
            "SELECT label FROM speakers WHERE person_id = ?1 ORDER BY rowid DESC LIMIT 1",
            [person_id],
            |r| r.get(0),
        )
        .optional()?;
    let display = label.unwrap_or_else(|| person_id.to_string());
    let words: Vec<&str> = display.split_whitespace().collect();
    Ok(PersonChip {
        id: PersonId::new(person_id),
        short_name: match words.as_slice() {
            [first, .., last] => format!("{first} {}.", last.chars().next().unwrap_or_default()),
            _ => display.clone(),
        },
        initials: words
            .iter()
            .filter_map(|w| w.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase(),
        display_name: display,
        is_you: false,
    })
}

fn spans_of(c: &Connection, item_id: &str) -> Db<Vec<TimeSpan>> {
    c.prepare(
        "SELECT call_id, channel, t0_ms, t1_ms FROM item_spans WHERE item_id = ?1 ORDER BY t0_ms",
    )?
    .query_map([item_id], |r| {
        Ok(TimeSpan {
            call_id: CallId::new(r.get::<_, String>(0)?),
            channel: r.get::<_, Option<String>>(1)?.map(word).transpose()?,
            t0_ms: OffsetMs(r.get(2)?),
            t1_ms: OffsetMs(r.get(3)?),
        })
    })?
    .collect()
}

fn assemble(c: &Connection, s: Stored) -> Db<ItemView> {
    let kind: ItemKind = word(s.kind.clone())?;
    let status: ItemStatus = word(s.status.clone())?;
    let owner = s.owner.as_deref().map(|p| owner_chip(c, p)).transpose()?;
    let carried_from = s
        .carried_from
        .as_deref()
        .map(|id| {
            c.query_row(
                "SELECT title, started_at, call_type FROM calls WHERE id = ?1",
                [id],
                |r| {
                    Ok(CallRef {
                        id: CallId::new(id),
                        title: r.get(0)?,
                        started_at: TimestampMs(r.get(1)?),
                        call_type: CallTypeId(r.get(2)?),
                    })
                },
            )
            .optional()
        })
        .transpose()?
        .flatten();
    // shortcut: nobody is "you" before library-people, so an owned action item reads as owed
    // to you and everything else as Other.
    let owed = match (&owner, kind) {
        (Some(o), ItemKind::ActionItem) if o.is_you => Owed::ByYou,
        (Some(_), ItemKind::ActionItem) => Owed::ToYou,
        _ => Owed::Other,
    };
    let handoff = match (status, &s.handoff_target, s.handed_off_at) {
        (ItemStatus::HandedOff, Some(target), Some(at)) => Some(HandoffSummary {
            target: word(target.clone())?,
            at: TimestampMs(at),
            cwd: s.handoff_cwd.clone().unwrap_or_default(),
            awaiting: true,
        }),
        _ => None,
    };
    Ok(ItemView {
        spans: spans_of(c, &s.id)?,
        id: ItemId::new(s.id),
        rev: Rev(s.rev),
        call: s.call,
        kind,
        edited: s.generated_text.as_ref().is_some_and(|g| *g != s.text),
        text: s.text,
        lang: lang_of(s.lang),
        owner,
        due: s.due.map(LocalDate),
        status,
        review: word(s.review)?,
        created_by: word(s.created_by)?,
        // Topics arrive with M3; the join keeps its shape.
        topic: None,
        is_engineering: s.engineering,
        linked_issue: s.issue,
        handoff,
        closed_by: None,
        done_at: s.done_at.map(TimestampMs),
        owed,
        carried_from,
    })
}

fn clock(ms: u32) -> String {
    format!("{}:{:02}", ms / 60_000, ms / 1000 % 60)
}

fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this item no longer exists")
}

/// A text of 1..=1000 characters, trimmed.
fn text_of(text: &str, field: &str) -> Result<String, CoreError> {
    let text = text.trim();
    match text.chars().count() {
        0 => Err(invalid(field, ValidationRule::Required)),
        n if n > MAX_TEXT => Err(invalid(field, ValidationRule::TooLong)),
        _ => Ok(text.to_string()),
    }
}

fn date_of(date: &LocalDate, field: &str) -> Result<String, CoreError> {
    day_number(date)
        .map(|_| date.0.clone())
        .ok_or_else(|| invalid(field, ValidationRule::InvalidFormat))
}

/// `VSTOR-123`: capital letters or digits, a dash and digits.
fn issue_key(key: &str) -> bool {
    let Some((project, number)) = key.split_once('-') else {
        return false;
    };
    project.starts_with(|c: char| c.is_ascii_uppercase())
        && project
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        && !number.is_empty()
        && number.bytes().all(|b| b.is_ascii_digit())
}

/// What an intent decided: the columns to set, or nothing when the wanted state is already there.
type Wanted = Option<Vec<(&'static str, Value)>>;

impl Core {
    // @cpt-flow:cpt-noter-flow-core-items-today-read:p1
    pub(crate) fn list_items(&self, args: ItemsListArgs) -> Result<Page<ItemView>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-items-today-read:p1:inst-read-list
        self.ready()?;
        let f = &args.filter;
        let mut w = Where {
            sql: String::new(),
            params: vec![],
        };
        let mut clauses: Vec<String> = vec!["1 = 1".into()];
        if let Some(id) = &f.call_id {
            clauses.push(format!("i.call_id = {}", w.bind(id.as_str().to_string())));
        }
        if let Some(id) = &f.person_id {
            clauses.push(format!(
                "i.owner_person_id = {}",
                w.bind(id.as_str().to_string())
            ));
        }
        if let Some(id) = &f.topic_id {
            clauses.push(format!("i.topic_id = {}", w.bind(id.as_str().to_string())));
        }
        for (column, words) in [
            ("i.kind", f.kinds.iter().map(name).collect::<Vec<_>>()),
            ("i.status", f.statuses.iter().map(name).collect()),
            ("i.review_state", f.reviews.iter().map(name).collect()),
        ] {
            if !words.is_empty() {
                clauses.push(format!("{column} IN ({})", w.bind_all(words)));
            }
        }
        if let Some(due) = &f.due_before {
            let due = date_of(due, "filter.due_before")?;
            clauses.push(format!(
                "i.due_date IS NOT NULL AND i.due_date < {}",
                w.bind(due)
            ));
        }
        w.sql = clauses.join(" AND ");
        let limit = args.page.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE) as usize;
        let after = args.page.cursor.as_ref().map(parse_cursor).transpose()?;
        // @cpt-end:cpt-noter-flow-core-items-today-read:p1:inst-read-list
        self.store().read(|c| {
            let total: u32 = c.query_row(
                &format!(
                    "SELECT count(*) FROM items i JOIN calls c ON c.id = i.call_id WHERE {}",
                    w.sql
                ),
                params_from_iter(w.params.iter()),
                |r| r.get(0),
            )?;
            // Newest call first, then the item id: stable under inserts and edits.
            if let Some((started, id)) = after {
                let (k, id) = (w.bind(started), w.bind(id));
                w.sql = format!(
                    "{} AND (c.started_at < {k} OR (c.started_at = {k} AND i.id > {id}))",
                    w.sql
                );
            }
            let sql = format!(
                "SELECT {COLUMNS} FROM items i JOIN calls c ON c.id = i.call_id WHERE {}
                 ORDER BY c.started_at DESC, i.id ASC LIMIT {}",
                w.sql,
                limit + 1
            );
            let mut rows = c
                .prepare(&sql)?
                .query_map(params_from_iter(w.params.iter()), stored)?
                .collect::<Result<Vec<_>, _>>()?;
            let more = rows.len() > limit;
            rows.truncate(limit);
            let next_cursor = rows
                .last()
                .filter(|_| more)
                .map(|s| cursor_of(json!(s.call.started_at.0), &s.id));
            Ok(Page {
                rows: rows
                    .into_iter()
                    .map(|s| assemble(c, s))
                    .collect::<Result<_, _>>()?,
                next_cursor,
                total: Some(total),
            })
        })
    }

    pub(crate) fn item_view(&self, id: &str) -> Result<Option<ItemView>, CoreError> {
        self.store()
            .read(|c| select_item(c, id)?.map(|s| assemble(c, s)).transpose())
    }

    pub(crate) fn get_item(&self, args: ItemIdArgs) -> Result<ItemDetail, CoreError> {
        self.ready()?;
        let id = args.item_id.as_str().to_string();
        // @cpt-begin:cpt-noter-flow-core-items-today-read:p1:inst-read-detail
        let found = self.store().read(|c| {
            let Some(s) = select_item(c, &id)? else {
                return Ok(None);
            };
            let item = assemble(c, s)?;
            // @cpt-begin:cpt-noter-flow-core-items-today-read:p1:inst-read-span
            // @cpt-begin:cpt-noter-flow-core-items-today-read:p1:inst-read-preview
            let evidence = item
                .spans
                .iter()
                .map(|span| {
                    let words: Vec<String> = segments_of(
                        c,
                        &span.call_id,
                        Some((span.channel, span.t0_ms, span.t1_ms)),
                    )?
                    .into_iter()
                    .map(|s| s.text)
                    .collect();
                    let at = item.call.started_at.0 + i64::from(span.t0_ms.0);
                    Ok(EvidenceView {
                        id: EvidenceId::new(format!("evd_span_{id}_{}", span.t0_ms.0)),
                        source: EvidenceSource::Call,
                        reference: format!("{}–{}", clock(span.t0_ms.0), clock(span.t1_ms.0)),
                        url: None,
                        span: Some(span.clone()),
                        summary: words.join(" "),
                        confidence: ConfidenceLevel::High,
                        dated_at: TimestampMs(at),
                        collected_at: TimestampMs(at),
                        closed_item: false,
                    })
                })
                .collect::<Db<Vec<_>>>()?;
            // @cpt-end:cpt-noter-flow-core-items-today-read:p1:inst-read-preview
            // @cpt-end:cpt-noter-flow-core-items-today-read:p1:inst-read-span
            Ok(Some((item, evidence)))
        })?;
        let (item, evidence) = found.ok_or_else(not_found)?;
        let history = self
            .history_page(HistoryListArgs {
                target: HistoryTarget::Item {
                    item_id: args.item_id,
                },
                actor: ActorFilter::All,
                job_id: None,
                from: None,
                to: None,
                page: PageRequest {
                    cursor: None,
                    limit: None,
                },
            })?
            .rows;
        // @cpt-end:cpt-noter-flow-core-items-today-read:p1:inst-read-detail
        // @cpt-begin:cpt-noter-flow-core-items-today-read:p1:inst-read-return
        Ok(ItemDetail {
            item,
            evidence,
            history,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-read:p1:inst-read-return
    }

    /// The item and its `rev` check: a stale `rev` is `conflict` with the current one.
    // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-rev
    fn load_at(&self, id: &str, rev: Rev) -> Result<Stored, CoreError> {
        self.ready()?;
        let s = self
            .store()
            .read(|c| select_item(c, id))?
            .ok_or_else(not_found)?;
        if s.rev != rev.0 {
            return Err(CoreError::new(
                ErrorCode::Conflict,
                format!("item {id} changed since its rev"),
            )
            .with_detail(ErrorDetail::Conflict {
                current_rev: Rev(s.rev),
            }));
        }
        Ok(s)
    }
    // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-rev

    /// Writes what an intent wanted, or returns the item as it is with its latest change when
    /// the wanted state was already there.
    // @cpt-algo:cpt-noter-algo-core-items-today-mutate:p1
    fn apply(
        &self,
        ctx: &CommandCtx,
        s: Stored,
        wanted: Wanted,
        summary: &str,
        reason: &str,
    ) -> Result<ItemMutation, CoreError> {
        let Some(values) = wanted else {
            // shortcut: an item nobody changed has no change row, so the handle is empty.
            let id = s.id.clone();
            let change_id: Option<String> = self.store().read(move |c| {
                c.query_row(
                    "SELECT id FROM changes WHERE entity_type = 'item' AND entity_id = ?1
                     ORDER BY rowid DESC LIMIT 1",
                    [id],
                    |r| r.get(0),
                )
                .optional()
            })?;
            let item = self.item_view(&s.id)?.ok_or_else(not_found)?;
            return Ok(ItemMutation {
                item,
                change_id: ChangeId::new(change_id.unwrap_or_default()),
            });
        };
        // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-write
        let written = self.store().write(
            Mutation {
                entity_type: "item",
                table: "items",
                id: s.id.clone(),
                base_rev: Some(Rev(s.rev)),
                bump_rev: true,
                values,
            },
            self.change_meta(ctx, summary.into(), reason),
        )?;
        // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-write
        let item = self.item_view(&s.id)?.ok_or_else(not_found)?;
        self.items_published(std::slice::from_ref(&item));
        // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-return
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-return
        Ok(ItemMutation {
            item,
            change_id: written.change_id,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-return
        // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-return
    }

    /// After a commit: the whole changed items through `entity:changed` and each call's
    /// `items.json` refreshed. A failure is logged: the change is committed.
    // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-publish
    fn items_published(&self, items: &[ItemView]) {
        for item in items {
            self.emit_entity_changed(&EntityChanged::Item { item: item.clone() });
        }
        let calls: BTreeSet<&str> = items.iter().map(|i| i.call.id.as_str()).collect();
        self.items_files(calls.into_iter().map(String::from));
    }

    pub(crate) fn items_files(&self, calls: impl IntoIterator<Item = String>) {
        for call_id in calls {
            if let Err(e) = self.write_items_file(&call_id) {
                self.log(object(json!({
                    "level": "error", "module": "items", "code": "items_file", "message_len": e.message.len()
                })));
            }
        }
    }

    fn write_items_file(&self, call_id: &str) -> Result<(), CoreError> {
        let items = self.store().read(|c| {
            c.prepare(&format!(
                "SELECT {COLUMNS} FROM items i JOIN calls c ON c.id = i.call_id
                 WHERE i.call_id = ?1 ORDER BY i.id"
            ))?
            .query_map([call_id], stored)?
            .map(|s| assemble(c, s?))
            .collect::<Db<Vec<_>>>()
        })?;
        let dir = self.data_dir.join("audio").join(call_id);
        std::fs::create_dir_all(&dir).map_err(internal)?;
        let tmp = dir.join("items.json.tmp");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(internal)?;
        file.write_all(&serde_json::to_vec_pretty(&items).map_err(internal)?)
            .map_err(internal)?;
        file.sync_all().map_err(internal)?;
        std::fs::rename(&tmp, dir.join("items.json")).map_err(internal)
    }
    // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-publish

    // @cpt-flow:cpt-noter-flow-core-items-today-tick:p1
    pub(crate) fn set_item_done(
        &self,
        ctx: &CommandCtx,
        args: ItemDoneArgs,
    ) -> Result<ItemMutation, CoreError> {
        let s = self.load_at(args.item_id.as_str(), args.rev)?;
        let now = self.deps.clock.now().0;
        // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-wanted
        // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-handoff
        // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-commit
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-done
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-untick
        // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-validate
        // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-state
        let wanted: Wanted = match (args.done, s.status.as_str()) {
            (true, "done") | (false, "open") => None,
            (true, "open" | "carried") if s.review == "rejected" => {
                return Err(invalid("review", ValidationRule::OutOfRange))
            }
            (true, "open" | "carried") => Some(vec![
                ("status", json!("done")),
                ("review_state", json!("accepted")),
                ("done_at", json!(now)),
            ]),
            (false, "done") => Some(vec![("status", json!("open")), ("done_at", Value::Null)]),
            // A handed-off row is answered through `item_answer_handoff_landed`.
            _ => return Err(invalid("status", ValidationRule::OutOfRange)),
        };
        // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-state
        // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-validate
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-untick
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-done
        let summary = if args.done {
            "Ticked item"
        } else {
            "Unticked item"
        };
        let out = self.apply(ctx, s, wanted, summary, "item_set_done")?;
        // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-commit
        // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-handoff
        // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-wanted
        // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-return
        Ok(out)
        // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-return
    }

    // @cpt-flow:cpt-noter-flow-core-items-today-review:p1
    pub(crate) fn review_item(
        &self,
        ctx: &CommandCtx,
        args: ItemReviewArgs,
    ) -> Result<ItemMutation, CoreError> {
        let s = self.load_at(args.item_id.as_str(), args.rev)?;
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-single
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-accept
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-reject
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-restore
        let next = match (args.decision, s.review.as_str()) {
            (ReviewDecision::Accept, "suggested") => Some("accepted"),
            (ReviewDecision::Reject, "suggested") => Some("rejected"),
            (ReviewDecision::Restore, "rejected") => Some("suggested"),
            (ReviewDecision::Accept, "accepted")
            | (ReviewDecision::Reject, "rejected")
            | (ReviewDecision::Restore, "suggested") => None,
            _ => return Err(invalid("review", ValidationRule::OutOfRange)),
        };
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-restore
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-reject
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-accept
        let wanted = next.map(|n| vec![("review_state", json!(n))]);
        self.apply(ctx, s, wanted, "Reviewed item", "item_review")
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-single
    }

    pub(crate) fn review_all_items(
        &self,
        ctx: &CommandCtx,
        args: ReviewAllArgs,
    ) -> Result<ItemsBatchResult, CoreError> {
        self.ready()?;
        let call_id = args.call_id.as_str().to_string();
        let kinds: Vec<String> = args.kinds.iter().map(name).collect();
        let exists: bool = {
            let id = call_id.clone();
            self.store().read(move |c| {
                c.query_row("SELECT count(*) FROM calls WHERE id = ?1", [id], |r| {
                    r.get::<_, u32>(0).map(|n| n > 0)
                })
            })?
        };
        if !exists {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                "this call no longer exists",
            ));
        }
        let mut meta = self.change_meta(ctx, "Accepted suggested items".into(), "items_review_all");
        // A batch id even for one row, so the caller can always undo it as a batch.
        meta.batch_id = Some(BatchId::new(format!("bat_{}", ulid::Ulid::generate())));
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-batch
        // @cpt-begin:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-bulk
        // The rows are selected and written in one writer transaction, so none can go stale in
        // between; rows that are not suggested are counted as skipped.
        let (eligible, skipped) = self.store().read({
            let (call_id, kinds) = (call_id.clone(), kinds.clone());
            move |c| suggested_in(c, &call_id, &kinds)
        })?;
        if eligible.is_empty() {
            return Ok(ItemsBatchResult {
                items: vec![],
                batch_id: None,
                skipped,
            });
        }
        let custom = self.store().write_with(meta, move |tx| {
            let (ids, skipped) = suggested_in(tx, &call_id, &kinds).map_err(internal)?;
            let mut logged = vec![];
            for id in &ids {
                tx.execute(
                    "UPDATE items SET review_state = 'accepted', rev = rev + 1 WHERE id = ?1",
                    [id],
                )
                .map_err(internal)?;
                logged.push(Logged {
                    entity_type: "item",
                    entity_id: id.clone(),
                    field: Some("review_state".into()),
                    before: Some("suggested".into()),
                    after: Some("accepted".into()),
                    delta: None,
                });
            }
            Ok(((ids, skipped), logged))
        })?;
        // @cpt-end:cpt-noter-algo-core-items-today-mutate:p1:inst-mutate-bulk
        let (ids, skipped) = custom.value;
        let items = ids
            .iter()
            .map(|id| self.item_view(id)?.ok_or_else(not_found))
            .collect::<Result<Vec<_>, _>>()?;
        self.items_published(&items);
        Ok(ItemsBatchResult {
            items,
            batch_id: custom.batch_id,
            skipped,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-batch
    }

    pub(crate) fn edit_item(
        &self,
        ctx: &CommandCtx,
        args: ItemEditArgs,
    ) -> Result<ItemMutation, CoreError> {
        let s = self.load_at(args.item_id.as_str(), args.rev)?;
        let p = &args.patch;
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-edit
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-accept-edit
        let mut values: Vec<(&'static str, Value)> = vec![];
        if let Some(text) = &p.text {
            values.push(("text", json!(text_of(text, "text")?)));
            // The generated wording stays for the diff, once.
            if s.generated_text.is_none() && s.created_by == "llm" {
                values.push(("generated_text", json!(s.text)));
            }
        }
        if let Some(kind) = p.kind {
            values.push(("kind", json!(name(&kind))));
        }
        match &p.owner {
            None => {}
            Some(OptionalPerson::Clear) => values.push(("owner_person_id", Value::Null)),
            Some(OptionalPerson::Set { person }) => {
                values.push(("owner_person_id", json!(self.known_person(person)?)))
            }
        }
        match &p.due {
            None => {}
            Some(OptionalDate::Clear) => values.push(("due_date", Value::Null)),
            Some(OptionalDate::Set { date }) => {
                values.push(("due_date", json!(date_of(date, "due")?)))
            }
        }
        match &p.linked_issue {
            None => {}
            Some(OptionalText::Clear) => values.push(("linked_issue_key", Value::Null)),
            Some(OptionalText::Set { text }) => {
                let key = text.trim();
                if !issue_key(key) {
                    return Err(invalid("linked_issue", ValidationRule::InvalidFormat));
                }
                values.push(("linked_issue_key", json!(key)));
            }
        }
        if let Some(engineering) = p.is_engineering {
            values.push(("is_engineering", json!(engineering)));
        }
        // Topics arrive with M3: none can be named yet.
        if p.topic_id.is_some() {
            return Err(invalid("topic_id", ValidationRule::OutOfRange));
        }
        // An empty patch changes nothing: omitted fields stay as they are.
        let wanted = (!values.is_empty()).then_some(values);
        self.apply(ctx, s, wanted, "Edited item", "item_edit")
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-accept-edit
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-edit
    }

    /// The person an item may be owned by: shortcut, one a speaker row names, until
    /// library-people; a new person cannot be made from here yet.
    fn known_person(&self, person: &PersonRef) -> Result<String, CoreError> {
        let PersonRef::Existing { person_id } = person else {
            return Err(invalid("owner", ValidationRule::InvalidFormat));
        };
        let id = person_id.as_str().to_string();
        let known: bool = {
            let id = id.clone();
            self.store().read(move |c| {
                c.query_row(
                    "SELECT EXISTS (SELECT 1 FROM speakers WHERE person_id = ?1)",
                    [id],
                    |r| r.get(0),
                )
            })?
        };
        known
            .then_some(id)
            .ok_or_else(|| invalid("owner", ValidationRule::OutOfRange))
    }

    pub(crate) fn reopen_item(
        &self,
        ctx: &CommandCtx,
        args: ItemReopenArgs,
    ) -> Result<ItemMutation, CoreError> {
        let s = self.load_at(args.item_id.as_str(), args.rev)?;
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-reopen
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-reopen
        if !matches!(
            s.status.as_str(),
            "done" | "handed_off" | "closed_by_evidence" | "answered_in_call"
        ) {
            return Err(invalid("status", ValidationRule::OutOfRange));
        }
        // Review, history and the evidence rows stay; the pointer to the closing evidence goes.
        let values = vec![
            ("status", json!("open")),
            ("done_at", Value::Null),
            ("closed_by_evidence_id", Value::Null),
        ];
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-reopen
        self.apply(ctx, s, Some(values), "Reopened item", "item_reopen")
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-reopen
    }

    pub(crate) fn answer_handoff(
        &self,
        ctx: &CommandCtx,
        args: HandoffLandedArgs,
    ) -> Result<ItemMutation, CoreError> {
        let s = self.load_at(args.item_id.as_str(), args.rev)?;
        if s.status != "handed_off" {
            return Err(invalid("status", ValidationRule::OutOfRange));
        }
        let now = self.deps.clock.now().0;
        // @cpt-begin:cpt-noter-flow-core-items-today-tick:p1:inst-tick-answer
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-landed
        // @cpt-begin:cpt-noter-state-core-items-today-item:p1:inst-st-keep-open
        let (closes, reason) = match args.answer {
            HandoffLandedAnswer::Landed => (true, "item_answer_handoff_landed: landed"),
            HandoffLandedAnswer::DoneAnotherWay => {
                (true, "item_answer_handoff_landed: done_another_way")
            }
            HandoffLandedAnswer::KeepOpen => (false, "item_answer_handoff_landed: keep_open"),
        };
        let values = closes.then(|| vec![("status", json!("done")), ("done_at", json!(now))]);
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-keep-open
        // @cpt-end:cpt-noter-state-core-items-today-item:p1:inst-st-landed
        self.apply(ctx, s, values, "Answered handoff", reason)
        // @cpt-end:cpt-noter-flow-core-items-today-tick:p1:inst-tick-answer
    }

    pub(crate) fn create_item(
        &self,
        ctx: &CommandCtx,
        args: ItemCreateArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-items-today-review:p1:inst-review-create
        let text = text_of(&args.text, "text")?;
        let due = args.due.as_ref().map(|d| date_of(d, "due")).transpose()?;
        let owner = args
            .owner
            .as_ref()
            .map(|o| self.known_person(o))
            .transpose()?;
        let call_id = args.call_id.as_str().to_string();
        let (started, ended): (i64, Option<i64>) = {
            let id = call_id.clone();
            self.store().read(move |c| {
                c.query_row(
                    "SELECT started_at, ended_at FROM calls WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
            })?
        }
        .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "this call no longer exists"))?;
        if let Some(span) = &args.span {
            // A span is inside its own call, forwards, and inside the recording once it ended.
            let bad = span.call_id != args.call_id
                || span.t0_ms >= span.t1_ms
                || ended.is_some_and(|e| i64::from(span.t1_ms.0) > e - started);
            if bad {
                return Err(invalid("span", ValidationRule::OutOfRange));
            }
        }
        let id = format!("itm_{}", ulid::Ulid::generate());
        let columns: Vec<(&'static str, Value)> = vec![
            ("call_id", json!(call_id)),
            ("kind", json!(name(&args.kind))),
            ("text", json!(text)),
            // shortcut: the language is not detected for typed text yet; English until it is.
            ("lang", json!(lang_code(&Lang::En))),
            ("owner_person_id", json!(owner)),
            ("due_date", json!(due)),
            ("status", json!("open")),
            ("review_state", json!("accepted")),
            ("created_by", json!("user")),
            ("is_engineering", json!(0)),
        ];
        let span = args.span.clone();
        let item_id = id.clone();
        let meta = self.change_meta(ctx, "Added item".into(), "item_create");
        let custom = self.store().write_with(meta, move |tx| {
            let names: Vec<&str> = columns.iter().map(|(c, _)| *c).collect();
            tx.execute(
                &format!(
                    "INSERT INTO items (id, rev, {}) VALUES (?, 1, {})",
                    names.join(", "),
                    vec!["?"; names.len()].join(", ")
                ),
                params_from_iter(
                    std::iter::once(Sql::Text(item_id.clone()))
                        .chain(columns.iter().map(|(_, v)| sql_of(v))),
                ),
            )
            .map_err(internal)?;
            if let Some(span) = span {
                tx.execute(
                    "INSERT INTO item_spans (item_id, call_id, channel, t0_ms, t1_ms)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    noter_db::rusqlite::params![
                        item_id,
                        span.call_id.as_str(),
                        span.channel.as_ref().map(name),
                        span.t0_ms.0,
                        span.t1_ms.0
                    ],
                )
                .map_err(internal)?;
            }
            // A created row logs every column it set, so undo can delete it (and redo insert it).
            let delta: serde_json::Map<String, Value> = columns
                .into_iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(c, v)| (c.to_string(), json!([Value::Null, v])))
                .collect();
            Ok((
                (),
                vec![Logged {
                    entity_type: "item",
                    entity_id: item_id,
                    field: None,
                    before: None,
                    after: None,
                    delta: Some(Value::Object(delta)),
                }],
            ))
        })?;
        let item = self.item_view(&id)?.ok_or_else(not_found)?;
        self.items_published(std::slice::from_ref(&item));
        Ok(ItemMutation {
            item,
            change_id: custom
                .change_ids
                .into_iter()
                .next()
                .ok_or_else(|| internal("no change row"))?,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-review:p1:inst-review-create
    }
}

/// The call's suggested items of these kinds (all kinds when none), and how many other rows of
/// those kinds it holds.
fn suggested_in(c: &Connection, call_id: &str, kinds: &[String]) -> Db<(Vec<String>, u32)> {
    let mut w = Where {
        sql: String::new(),
        params: vec![],
    };
    let mut sql = format!("i.call_id = {}", w.bind(call_id.to_string()));
    if !kinds.is_empty() {
        sql = format!(
            "{sql} AND i.kind IN ({})",
            w.bind_all(kinds.iter().cloned())
        );
    }
    let rows: Vec<(String, String)> = c
        .prepare(&format!(
            "SELECT i.id, i.review_state FROM items i WHERE {sql} ORDER BY i.id"
        ))?
        .query_map(params_from_iter(w.params.iter()), |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<Result<_, _>>()?;
    let skipped = rows.iter().filter(|(_, r)| r != "suggested").count() as u32;
    Ok((
        rows.into_iter()
            .filter(|(_, r)| r == "suggested")
            .map(|(id, _)| id)
            .collect(),
        skipped,
    ))
}

/// The calls whose items the change or batch behind an undo target touched, read before the
/// reversal (an undone creation leaves no row to find them by afterwards).
pub(crate) fn calls_of_target(c: &Connection, target: &UndoTarget) -> Db<BTreeSet<String>> {
    let (column, id) = match target {
        UndoTarget::Change { change_id } => ("ch.id", change_id.as_str()),
        UndoTarget::Batch { batch_id } => ("ch.batch_id", batch_id.as_str()),
    };
    c.prepare(&format!(
        "SELECT DISTINCT i.call_id FROM changes ch JOIN items i ON i.id = ch.entity_id
         WHERE ch.entity_type = 'item' AND {column} = ?1"
    ))?
    .query_map([id], |r| r.get(0))?
    .collect()
}
