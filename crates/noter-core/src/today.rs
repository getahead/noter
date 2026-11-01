//! FEATURE cpt-noter-feature-core-items-today (slice 2): call tags, the carry-forward query
//! and Today.

use std::collections::BTreeSet;

use noter_db::rusqlite::types::Value as Sql;
use noter_db::rusqlite::{params_from_iter, Connection, OptionalExtension};
use noter_db::{call_tags_text, Logged};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;

use crate::first_run::CalendarEvent;
use crate::items::{items_where, owner_chip};
use crate::library::SHOWN_PASS;
use crate::settings::invalid;
use crate::{internal, lock, Core};

const MAX_TAG: usize = 32;
const DAY_MS: i64 = 86_400_000;
const WEEK_DAYS: i64 = 7;
/// Calls of the same people that Today carries work from.
const CARRY_CALLS: usize = 2;
const NO_DUE: &str = "9999-99-99";

type Db<T> = noter_db::rusqlite::Result<T>;
/// The calls to change, the tags to add and the tags to remove, each as (written, normalized).
type WantedTags = (Vec<String>, Vec<(String, String)>, Vec<(String, String)>);

/// A tag as written and as compared: trimmed, 1..=32 characters, unique ignoring case.
fn tag_of(raw: &str, field: &str) -> Result<(String, String), CoreError> {
    let tag = raw.trim();
    match tag.chars().count() {
        0 => Err(invalid(field, ValidationRule::Required)),
        n if n > MAX_TAG => Err(invalid(field, ValidationRule::TooLong)),
        _ => Ok((tag.to_string(), tag.to_lowercase())),
    }
}

fn tags_of(raw: &[String], field: &str) -> Result<Vec<(String, String)>, CoreError> {
    let mut seen = BTreeSet::new();
    let mut tags = vec![];
    for tag in raw {
        let (tag, norm) = tag_of(tag, field)?;
        if seen.insert(norm.clone()) {
            tags.push((tag, norm));
        }
    }
    Ok(tags)
}

fn not_found() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "this call no longer exists")
}

/// The calendar day of an instant, `YYYY-MM-DD`.
// shortcut: UTC, the prefs' time zone is fixed until the first-run feature reads the macOS one.
fn date_of(ms: i64) -> String {
    // Days to civil date (Howard Hinnant).
    let z = ms.div_euclid(DAY_MS) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

fn marks(n: usize) -> String {
    vec!["?"; n].join(", ")
}

fn texts(values: &[String]) -> Vec<Sql> {
    values.iter().cloned().map(Sql::Text).collect()
}

/// The person a calendar attendee is, by the name a named speaker carries.
// shortcut: no `people` table before library-people (M3), so a person is a named speaker and an
// attendee matches by name ignoring case.
fn known_person(c: &Connection, name: &str) -> Db<Option<PersonChip>> {
    let person: Option<String> = c
        .query_row(
            "SELECT person_id FROM speakers WHERE person_id IS NOT NULL AND lower(label) = lower(?1)
             ORDER BY rowid DESC LIMIT 1",
            [name.trim()],
            |r| r.get(0),
        )
        .optional()?;
    person.map(|p| owner_chip(c, &p)).transpose()
}

#[derive(Default)]
struct Carried {
    items: Vec<ItemView>,
    questions: Vec<ItemView>,
    handed_off: Vec<ItemView>,
}

/// The open work of the last two calls with `people` before `before`: items (suggested ones
/// still marked Not reviewed), open questions and awaiting handoffs, each with its source call.
// @cpt-algo:cpt-noter-algo-core-items-today-carry:p1
fn carry_forward(c: &Connection, people: &[String], before: i64) -> Db<Carried> {
    if people.is_empty() {
        return Ok(Carried::default());
    }
    // @cpt-begin:cpt-noter-algo-core-items-today-carry:p1:inst-carry-match
    // Participants are named speakers; unknown attendees alone never reach this query.
    let mut args = vec![Sql::Integer(before)];
    args.extend(texts(people));
    let calls: Vec<String> = c
        .prepare(&format!(
            "SELECT id FROM calls
             WHERE started_at < ? AND status NOT IN ('recording', 'paused')
               AND EXISTS (SELECT 1 FROM speakers s WHERE s.call_id = calls.id
                           AND s.person_id IN ({}) AND s.pass = {})
             ORDER BY started_at DESC LIMIT {CARRY_CALLS}",
            marks(people.len()),
            SHOWN_PASS.replace("?1", "calls.id"),
        ))?
        .query_map(params_from_iter(args), |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    // @cpt-end:cpt-noter-algo-core-items-today-carry:p1:inst-carry-match
    if calls.is_empty() {
        return Ok(Carried::default());
    }
    // @cpt-begin:cpt-noter-algo-core-items-today-carry:p1:inst-carry-select
    // @cpt-begin:cpt-noter-algo-core-items-today-carry:p1:inst-carry-join
    let clause = format!(
        "i.call_id IN ({}) AND ((i.status IN ('open', 'carried')
                                 AND i.review_state IN ('accepted', 'suggested'))
                                OR (i.status = 'handed_off' AND i.review_state = 'accepted'))",
        marks(calls.len())
    );
    let mut seen = BTreeSet::new();
    let mut carried = Carried::default();
    for mut item in items_where(c, &clause, texts(&calls))? {
        if !seen.insert(item.id.as_str().to_string()) {
            continue;
        }
        item.carried_from = Some(item.call.clone());
        match (item.status, item.kind) {
            (ItemStatus::HandedOff, _) => carried.handed_off.push(item),
            (_, ItemKind::OpenQuestion) => carried.questions.push(item),
            _ => carried.items.push(item),
        }
    }
    // @cpt-end:cpt-noter-algo-core-items-today-carry:p1:inst-carry-join
    // @cpt-end:cpt-noter-algo-core-items-today-carry:p1:inst-carry-select
    // @cpt-begin:cpt-noter-algo-core-items-today-carry:p1:inst-carry-return
    Ok(carried)
    // @cpt-end:cpt-noter-algo-core-items-today-carry:p1:inst-carry-return
}

/// Orders items per the ranking; ties fall to the older call, then the item id.
// @cpt-begin:cpt-noter-algo-core-items-today-carry:p1:inst-carry-rank
fn rank(items: &mut [ItemView], ranking: TodayRanking, people: &[String]) {
    let due = |i: &ItemView| i.due.as_ref().map_or(NO_DUE.to_string(), |d| d.0.clone());
    let owed_here = |i: &ItemView| {
        i.owner
            .as_ref()
            .is_some_and(|o| people.iter().any(|p| p == o.id.as_str()))
    };
    match ranking {
        TodayRanking::OwedToTodaysPeople => items.sort_by_cached_key(|i| {
            (
                !owed_here(i),
                due(i),
                i.call.started_at.0,
                i.id.as_str().to_string(),
            )
        }),
        TodayRanking::DueThenOwedToYou => items.sort_by_cached_key(|i| {
            (
                due(i),
                i.owed != Owed::ToYou,
                i.call.started_at.0,
                i.id.as_str().to_string(),
            )
        }),
    }
}
// @cpt-end:cpt-noter-algo-core-items-today-carry:p1:inst-carry-rank

/// One calendar event as a card, with the ids of the items it shows.
fn card_of(
    c: &Connection,
    event: &CalendarEvent,
    ranking: TodayRanking,
) -> Db<(UpcomingCall, Vec<String>)> {
    let attendees = event
        .attendees
        .iter()
        .map(|a| {
            Ok(AttendeeChip {
                person: known_person(c, &a.name)?,
                name: a.name.clone(),
                email: a.email.clone(),
            })
        })
        .collect::<Db<Vec<_>>>()?;
    let people: Vec<String> = attendees
        .iter()
        .filter_map(|a| a.person.as_ref().map(|p| p.id.as_str().to_string()))
        .collect();
    let mut carried = carry_forward(c, &people, event.event.starts_at.0)?;
    for list in [
        &mut carried.items,
        &mut carried.questions,
        &mut carried.handed_off,
    ] {
        rank(list, ranking, &people);
    }
    let shown: Vec<String> = [&carried.items, &carried.questions, &carried.handed_off]
        .into_iter()
        .flatten()
        .map(|i| i.id.as_str().to_string())
        .collect();
    let call_id: Option<String> = c
        .query_row(
            "SELECT id FROM calls WHERE calendar_event_id = ?1 ORDER BY started_at DESC LIMIT 1",
            [&event.event.id.0],
            |r| r.get(0),
        )
        .optional()?;
    let card = UpcomingCall {
        event_id: event.event.id.clone(),
        title: event.event.title.clone(),
        starts_at: event.event.starts_at,
        ends_at: event.event.ends_at,
        platform: event.platform.clone(),
        attendees,
        // shortcut: no advance sensitivity mark and no summaries before post-call (2.17).
        sensitive: false,
        call_id: call_id.map(CallId::new),
        last_time: None,
        open_count: shown.len() as u32,
        items: carried.items,
        questions: carried.questions,
        handed_off: carried.handed_off,
    };
    Ok((card, shown))
}

/// The sections of Today that come from local records and the calendar cards.
struct Sections {
    today: Vec<UpcomingCall>,
    this_week: Vec<UpcomingCall>,
    due_without_call: Vec<ItemView>,
    done_today: Vec<ItemView>,
    review_waiting: u32,
    first_use: bool,
}

struct Window {
    ranking: TodayRanking,
    week: bool,
    day_start: i64,
}

fn sections(c: &Connection, events: &[CalendarEvent], w: &Window) -> Db<Sections> {
    let day_end = w.day_start + DAY_MS;
    let week_end = w.day_start + (WEEK_DAYS + 1) * DAY_MS;
    let (mut today, mut this_week, mut shown) = (vec![], vec![], BTreeSet::new());
    let mut ordered: Vec<&CalendarEvent> = events.iter().collect();
    ordered.sort_by_key(|e| e.event.starts_at.0);
    for event in ordered {
        let at = event.event.starts_at.0;
        let in_week = w.week && (day_end..week_end).contains(&at);
        if !(w.day_start..day_end).contains(&at) && !in_week {
            continue;
        }
        let (card, ids) = card_of(c, event, w.ranking)?;
        shown.extend(ids);
        if at < day_end {
            today.push(card);
        } else {
            this_week.push(card);
        }
    }
    let date = date_of(w.day_start);
    let mut due_without_call = items_where(
        c,
        "i.status IN ('open', 'carried') AND i.review_state = 'accepted'
         AND i.due_date IS NOT NULL AND i.due_date <= ?",
        vec![Sql::Text(date)],
    )?;
    due_without_call.retain(|i| !shown.contains(i.id.as_str()));
    rank(&mut due_without_call, w.ranking, &[]);
    let done_today = items_where(
        c,
        "i.status = 'done' AND i.done_at >= ? AND i.done_at < ?",
        vec![Sql::Integer(w.day_start), Sql::Integer(day_end)],
    )?;
    Ok(Sections {
        today,
        this_week,
        due_without_call,
        done_today,
        review_waiting: c.query_row(
            "SELECT count(*) FROM items WHERE review_state = 'suggested'",
            [],
            |r| r.get(0),
        )?,
        first_use: c.query_row("SELECT count(*) = 0 FROM calls", [], |r| r.get(0))?,
    })
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-items-today-tags:p1
    pub(crate) fn set_call_tags(
        &self,
        ctx: &CommandCtx,
        args: TagsSetArgs,
    ) -> Result<TagsSetResult, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-items-today-tags:p1:inst-tags-set
        let add = tags_of(&args.add, "add")?;
        let remove = tags_of(&args.remove, "remove")?;
        let mut calls: Vec<String> = vec![];
        for id in &args.call_ids {
            if !calls.iter().any(|c| c == id.as_str()) {
                calls.push(id.as_str().to_string());
            }
        }
        if calls.is_empty() {
            return Err(invalid("call_ids", ValidationRule::Required));
        }
        // @cpt-end:cpt-noter-flow-core-items-today-tags:p1:inst-tags-set
        let meta = self.change_meta(ctx, "Changed tags".into(), "call_tags_set");
        // @cpt-begin:cpt-noter-flow-core-items-today-tags:p1:inst-tags-write
        // Every call is checked and changed in one writer transaction, so a missing call leaves
        // the others as they were; a call whose tags already are as wanted logs nothing.
        let wanted = (calls.clone(), add, remove);
        let differs = self.store().read({
            let wanted = wanted.clone();
            move |c| tags_differ(c, &wanted)
        })?;
        let (changed, change_id) = match differs {
            Err(missing) => return Err(missing),
            Ok(false) => (vec![], self.last_tags_change(&wanted.0[0])?),
            Ok(true) => {
                let written = self.store().write_with(meta, move |tx| {
                    let (calls, add, remove) = wanted;
                    let (mut changed, mut logged) = (vec![], vec![]);
                    for call in &calls {
                        let before = call_tags_text(tx, call).map_err(internal)?;
                        for (_, norm) in &remove {
                            tx.execute(
                                "DELETE FROM call_tags WHERE call_id = ?1 AND tag_norm = ?2",
                                [call, norm],
                            )
                            .map_err(internal)?;
                        }
                        for (tag, norm) in &add {
                            tx.execute(
                                "INSERT OR IGNORE INTO call_tags (call_id, tag, tag_norm)
                                 VALUES (?1, ?2, ?3)",
                                [call, tag, norm],
                            )
                            .map_err(internal)?;
                        }
                        let after = call_tags_text(tx, call).map_err(internal)?;
                        if before == after {
                            continue;
                        }
                        tx.execute("UPDATE calls SET rev = rev + 1 WHERE id = ?1", [call])
                            .map_err(internal)?;
                        changed.push(call.clone());
                        logged.push(Logged {
                            entity_type: "call",
                            entity_id: call.clone(),
                            field: Some("tags".into()),
                            before: Some(before),
                            after: Some(after),
                            delta: None,
                        });
                    }
                    Ok((changed, logged))
                })?;
                // shortcut: `TagsSetResult` has no batch id, so this handle undoes the first
                // changed call only; a contract field would let several calls undo together.
                (written.value, written.change_ids[0].clone())
            }
        };
        // @cpt-end:cpt-noter-flow-core-items-today-tags:p1:inst-tags-write
        // @cpt-begin:cpt-noter-flow-core-items-today-tags:p1:inst-tags-publish
        let rows = calls
            .iter()
            .map(|id| self.call_row(id)?.ok_or_else(not_found))
            .collect::<Result<Vec<_>, _>>()?;
        for call in rows
            .iter()
            .filter(|r| changed.iter().any(|c| c == r.id.as_str()))
        {
            self.emit_entity_changed(&EntityChanged::Call { call: call.clone() });
        }
        // @cpt-end:cpt-noter-flow-core-items-today-tags:p1:inst-tags-publish
        // @cpt-begin:cpt-noter-flow-core-items-today-tags:p1:inst-tags-return
        Ok(TagsSetResult {
            calls: rows,
            change_id,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-tags:p1:inst-tags-return
    }

    /// The newest tags change of a call, the handle of a request that changed nothing.
    fn last_tags_change(&self, call_id: &str) -> Result<ChangeId, CoreError> {
        let call_id = call_id.to_string();
        let id: Option<String> = self.store().read(move |c| {
            c.query_row(
                "SELECT id FROM changes WHERE entity_type = 'call' AND entity_id = ?1
                 AND field = 'tags' ORDER BY rowid DESC LIMIT 1",
                [call_id],
                |r| r.get(0),
            )
            .optional()
        })?;
        Ok(ChangeId::new(id.unwrap_or_default()))
    }

    pub(crate) fn list_tags(&self) -> Result<TagList, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-items-today-tags:p1:inst-tags-list
        let tags = self.store().read(|c| {
            c.prepare(
                "SELECT min(tag), count(*) FROM call_tags GROUP BY tag_norm
                 ORDER BY count(*) DESC, tag_norm",
            )?
            .query_map([], |r| {
                Ok(TagCount {
                    tag: r.get(0)?,
                    calls: r.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
        })?;
        Ok(TagList { tags })
        // @cpt-end:cpt-noter-flow-core-items-today-tags:p1:inst-tags-list
    }

    // @cpt-flow:cpt-noter-flow-core-items-today-dashboard:p1
    pub(crate) fn today_view(&self) -> Result<TodayView, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-request
        let now = self.deps.clock.now().0;
        let settings = lock(&self.settings).today.clone();
        let window = Window {
            ranking: settings.ranking,
            week: settings.horizon == DashboardHorizon::ThisWeek,
            day_start: now.div_euclid(DAY_MS) * DAY_MS,
        };
        let access = self.deps.native.permission(PermissionKind::Calendar);
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-request
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-no-access
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-calendar
        let (calendar, events) = match access {
            PermissionState::Granted => {
                let to = TimestampMs(window.day_start + (WEEK_DAYS + 1) * DAY_MS);
                let events = self
                    .deps
                    .native
                    .calendar_events(TimestampMs(window.day_start), to)
                    .map_err(|e| CoreError::new(ErrorCode::CalendarUnavailable, e.message))?;
                (CalendarAccess::Granted, events)
            }
            PermissionState::NotAsked => (CalendarAccess::NotAsked, vec![]),
            PermissionState::Denied | PermissionState::NeedsRelaunch => {
                (CalendarAccess::Denied, vec![])
            }
        };
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-calendar
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-no-access
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-carry
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-sections
        let found = self.store().read(move |c| sections(c, &events, &window))?;
        let live_id: Option<String> = self.store().read(|c| {
            c.query_row(
                "SELECT id FROM calls WHERE status IN ('recording', 'paused')
                 ORDER BY started_at DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
        })?;
        let live_call = live_id.map(|id| self.call_row(&id)).transpose()?.flatten();
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-sections
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-carry
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-banners
        let setup = self.setup_now();
        let mut banners = vec![];
        if !matches!(setup.self_test, SelfTestState::Passed { .. }) {
            banners.push(TodayBanner::SelfTestNotPassed);
        }
        if let Some(call) = self.interrupted_banner() {
            banners.push(TodayBanner::RecordingInterruptedByQuit { call });
        }
        let mic = setup
            .permissions
            .iter()
            .find(|p| p.kind == PermissionKind::Microphone);
        if mic.is_some_and(|p| p.state == PermissionState::NotAsked) {
            banners.push(TodayBanner::AudioAccessNeverGranted);
        }
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-banners
        // @cpt-begin:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-return
        Ok(TodayView {
            date: LocalDate(date_of(now)),
            ranking: settings.ranking,
            calendar,
            live_call,
            today: found.today,
            this_week: found.this_week,
            due_without_call: found.due_without_call,
            done_today: found.done_today,
            review_waiting: found.review_waiting,
            // shortcut: proposals are produced from M5; Today shows none before.
            proposals: vec![],
            proposals_total: 0,
            banners,
            first_use: found.first_use,
        })
        // @cpt-end:cpt-noter-flow-core-items-today-dashboard:p1:inst-today-return
    }
}

/// `Ok(true)` when some call's tags differ from the wanted ones, `Err` when a call is missing.
fn tags_differ(c: &Connection, (calls, add, remove): &WantedTags) -> Db<Result<bool, CoreError>> {
    let mut differs = false;
    for call in calls {
        let held: BTreeSet<String> = c
            .prepare("SELECT tag_norm FROM call_tags WHERE call_id = ?1")?
            .query_map([call], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        if held.is_empty() {
            let found: u32 =
                c.query_row("SELECT count(*) FROM calls WHERE id = ?1", [call], |r| {
                    r.get(0)
                })?;
            if found == 0 {
                return Ok(Err(not_found()));
            }
        }
        differs |= add.iter().any(|(_, n)| !held.contains(n))
            || remove.iter().any(|(_, n)| held.contains(n));
    }
    Ok(Ok(differs))
}
