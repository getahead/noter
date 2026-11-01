//! FEATURE cpt-noter-feature-core-items-today (slice 2): call tags, the carry-forward query and
//! Today. Calendar reads go through a scripted `NativeServices`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{
    BoxFuture, CalendarAttendee, CalendarEvent, Clock, Core, CoreDeps, EnvironmentReading,
    EventEmitter, NativeServices,
};
use noter_db::Insert;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

/// 2026-10-16 08:00 UTC.
const NOW: i64 = 1_792_137_600_000;
const HOUR: i64 = 3_600_000;
const DAY: i64 = 24 * HOUR;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn named(&self, name: &str) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let (taken, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut *all)
            .into_iter()
            .partition(|(e, _)| *e == name);
        *all = kept;
        taken.into_iter().map(|(_, p)| p).collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

/// A Mac whose calendar permission and events the test scripts.
struct Calendar {
    access: PermissionState,
    events: Result<Vec<CalendarEvent>, ()>,
}

impl NativeServices for Calendar {
    fn permission(&self, kind: PermissionKind) -> PermissionState {
        match kind {
            PermissionKind::Calendar => self.access,
            _ => PermissionState::Granted,
        }
    }
    fn request_permission(&self, _: PermissionKind) -> BoxFuture<'_, PermissionState> {
        panic!("Today never asks for a permission")
    }
    fn environment(&self) -> EnvironmentReading {
        EnvironmentReading::default()
    }
    fn set_login_item(&self, _: bool) -> Result<(), CoreError> {
        Ok(())
    }
    fn calendar_events(
        &self,
        _: TimestampMs,
        _: TimestampMs,
    ) -> Result<Vec<CalendarEvent>, CoreError> {
        self.events
            .clone()
            .map_err(|()| CoreError::new(ErrorCode::CalendarUnavailable, "EventKit failed"))
    }
}

fn open_with(dir: &Path, native: Option<Calendar>) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let mut deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    if let Some(native) = native {
        deps = deps.with_native(Arc::new(native));
    }
    (Core::open(dir, deps).expect("core opens"), events)
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    open_with(dir, None)
}

fn window(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

fn ctx() -> CommandCtx {
    window(WindowLabel::Main)
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

fn call(id: &str, started: i64, status: &str) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(started + 600_000)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!(status)),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn speaker(id: &str, call_id: &str, label: &str, person: &str) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("channel", json!("sys")),
            ("person_id", json!(person)),
            ("named_by", json!("you")),
            ("pass", json!("live")),
        ],
    )
}

fn item(id: &str, call_id: &str, kind: &str, status: &str, review: &str) -> Insert {
    row(
        "items",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("text", json!(format!("Text of {id}"))),
            ("lang", json!("en")),
            ("status", json!(status)),
            ("review_state", json!(review)),
            ("created_by", json!("llm")),
            ("is_engineering", json!(0)),
        ],
    )
}

fn insert(core: &Core, rows: Vec<Insert>) {
    core.store().insert_batch(rows).unwrap();
}

fn exec(dir: &Path, sql: &str) {
    noter_db::rusqlite::Connection::open(dir.join("noter.db"))
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}

fn count(core: &Core, table: &'static str) -> u32 {
    core.store()
        .read(move |c| c.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)))
        .unwrap()
}

fn ids(items: &[ItemView]) -> Vec<&str> {
    items.iter().map(|i| i.id.as_str()).collect()
}

fn id(call_id: &str) -> CallId {
    CallId::new(call_id)
}

async fn tags(
    core: &Core,
    calls: &[&str],
    add: &[&str],
    remove: &[&str],
) -> Result<TagsSetResult, CoreError> {
    core.call_tags_set(
        &ctx(),
        TagsSetArgs {
            call_ids: calls.iter().map(|c| id(c)).collect(),
            add: add.iter().map(ToString::to_string).collect(),
            remove: remove.iter().map(ToString::to_string).collect(),
        },
    )
    .await
}

async fn tag_list(core: &Core) -> Vec<(String, u32)> {
    core.tags_list(&ctx(), NoArgs {})
        .await
        .unwrap()
        .tags
        .into_iter()
        .map(|t| (t.tag, t.calls))
        .collect()
}

fn call_tags(call: &CallRow) -> Vec<&str> {
    call.tags.iter().map(String::as_str).collect()
}

fn target(change_id: ChangeId) -> UndoTarget {
    UndoTarget::Change { change_id }
}

// ---- call tags ------------------------------------------------------------------------------

#[tokio::test]
async fn tags_are_added_removed_and_listed_with_counts() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    insert(
        &core,
        vec![
            call("c1", NOW - DAY, "ready"),
            call("c2", NOW - 2 * DAY, "ready"),
        ],
    );

    let set = tags(&core, &["c1", "c2"], &["Roadmap", "q4"], &[])
        .await
        .unwrap();
    assert_eq!(set.calls.len(), 2);
    assert_eq!(call_tags(&set.calls[0]), ["q4", "Roadmap"]);
    assert_eq!(set.calls[0].rev, Rev(2));
    let published = events.named(event_names::ENTITY_CHANGED);
    assert_eq!(published.len(), 2, "whole changed calls, one event each");

    tags(&core, &["c1"], &[], &["roadmap"]).await.unwrap();
    assert_eq!(
        tag_list(&core).await,
        [("q4".to_string(), 2), ("Roadmap".to_string(), 1)]
    );
}

#[tokio::test]
async fn tags_are_unique_ignoring_case_and_repeats_change_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    insert(&core, vec![call("c1", NOW - DAY, "ready")]);

    let first = tags(&core, &["c1"], &["Alpha", "alpha", " ALPHA "], &[])
        .await
        .unwrap();
    assert_eq!(call_tags(&first.calls[0]), ["Alpha"]);
    let rev = first.calls[0].rev;

    let again = tags(&core, &["c1"], &["aLpHa"], &["missing"])
        .await
        .unwrap();
    assert_eq!(again.calls[0].rev, rev, "nothing changed, no new revision");
    assert_eq!(again.change_id, first.change_id, "and no new change row");
    assert_eq!(tag_list(&core).await, [("Alpha".to_string(), 1)]);
}

#[tokio::test]
async fn invalid_tags_and_missing_calls_write_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    insert(&core, vec![call("c1", NOW - DAY, "ready")]);

    for bad in ["", "   ", &"x".repeat(33)] {
        let err = tags(&core, &["c1"], &["fine", bad], &[]).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidInput, "{bad:?}");
    }
    let err = tags(&core, &["c1", "gone"], &["fine"], &[])
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
    assert!(tag_list(&core).await.is_empty());
    assert_eq!(count(&core, "changes"), 0, "no orphan change rows");
}

#[tokio::test]
async fn undo_restores_the_tags_and_redo_sets_them_again() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    insert(&core, vec![call("c1", NOW - DAY, "ready")]);
    tags(&core, &["c1"], &["keep"], &[]).await.unwrap();
    let set = tags(&core, &["c1"], &["new"], &["keep"]).await.unwrap();
    assert_eq!(call_tags(&set.calls[0]), ["new"]);
    events.named(event_names::ENTITY_CHANGED);

    let undone = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: target(set.change_id.clone()),
            },
        )
        .await
        .unwrap();
    assert_eq!(undone.undone, 1);
    assert_eq!(tag_list(&core).await, [("keep".to_string(), 1)]);
    assert_eq!(events.named(event_names::ENTITY_CHANGED).len(), 1);

    let redone = core
        .change_redo(
            &ctx(),
            RedoArgs {
                target: target(set.change_id),
            },
        )
        .await
        .unwrap();
    assert_eq!(redone.undone, 1);
    assert_eq!(tag_list(&core).await, [("new".to_string(), 1)]);
}

#[tokio::test]
async fn undo_after_a_later_tag_edit_keeps_the_later_edit() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    insert(&core, vec![call("c1", NOW - DAY, "ready")]);
    let first = tags(&core, &["c1"], &["a"], &[]).await.unwrap();
    tags(&core, &["c1"], &["b"], &[]).await.unwrap();

    let err = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: target(first.change_id),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::EditedLater);
    assert_eq!(tag_list(&core).await.len(), 2);
}

// ---- Today ------------------------------------------------------------------------------------

fn event(id: &str, title: &str, starts: i64, attendees: &[&str]) -> CalendarEvent {
    CalendarEvent {
        event: CalendarEventRef {
            id: CalendarEventId(id.into()),
            title: title.into(),
            starts_at: TimestampMs(starts),
            ends_at: TimestampMs(starts + HOUR),
        },
        platform: Some("Zoom".into()),
        attendees: attendees
            .iter()
            .map(|n| CalendarAttendee {
                name: (*n).into(),
                email: None,
            })
            .collect(),
    }
}

fn granted(events: Vec<CalendarEvent>) -> Calendar {
    Calendar {
        access: PermissionState::Granted,
        events: Ok(events),
    }
}

async fn today(core: &Core) -> Result<TodayView, CoreError> {
    core.today_get(&ctx(), NoArgs {}).await
}

/// Anna on three earlier calls, Bob on one more; items spread across them.
fn people_world(core: &Core) {
    insert(
        core,
        vec![
            call("old", NOW - 20 * DAY, "ready"),
            call("mid", NOW - 10 * DAY, "ready"),
            call("new", NOW - 3 * DAY, "ready"),
            call("bob", NOW - 2 * DAY, "ready"),
            speaker("s1", "old", "Anna Koval", "per_anna"),
            speaker("s2", "mid", "Anna Koval", "per_anna"),
            speaker("s3", "new", "Anna Koval", "per_anna"),
            speaker("s4", "bob", "Bob Ray", "per_bob"),
            item("i_old", "old", "action_item", "open", "accepted"),
            item("i_mid", "mid", "action_item", "open", "accepted"),
            item("i_new", "new", "action_item", "open", "accepted"),
            item("i_sugg", "new", "decision", "open", "suggested"),
            item("i_rej", "new", "risk", "open", "rejected"),
            item("i_done", "new", "action_item", "done", "accepted"),
            item("i_q", "new", "open_question", "open", "accepted"),
            item("i_hand", "mid", "action_item", "handed_off", "accepted"),
            item("i_bob", "bob", "action_item", "open", "accepted"),
        ],
    );
}

#[tokio::test]
async fn known_attendees_carry_open_work_from_the_last_two_calls() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(granted(vec![event(
            "e1",
            "1:1 Anna",
            NOW + HOUR,
            &["Anna Koval", "Stranger"],
        )])),
    );
    people_world(&core);

    let view = today(&core).await.unwrap();
    assert_eq!(view.calendar, CalendarAccess::Granted);
    let card = &view.today[0];
    assert_eq!(card.title, "1:1 Anna");
    assert_eq!(
        card.attendees[0].person.as_ref().unwrap().id.as_str(),
        "per_anna"
    );
    assert!(
        card.attendees[1].person.is_none(),
        "an unknown attendee stays a bare name"
    );
    // Open accepted and suggested items of `new` and `mid`; `old` is a third call, rejected and
    // done work stays out, the question and the handoff have their own collections.
    let mut carried = ids(&card.items);
    carried.sort();
    assert_eq!(carried, ["i_mid", "i_new", "i_sugg"]);
    assert_eq!(ids(&card.questions), ["i_q"]);
    assert_eq!(ids(&card.handed_off), ["i_hand"]);
    assert_eq!(card.open_count, 5);
    let from = card
        .items
        .iter()
        .find(|i| i.id.as_str() == "i_mid")
        .unwrap();
    assert_eq!(from.carried_from.as_ref().unwrap().id.as_str(), "mid");
}

#[tokio::test]
async fn unknown_attendees_alone_carry_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(granted(vec![event(
            "e1",
            "Intro",
            NOW + HOUR,
            &["Stranger"],
        )])),
    );
    people_world(&core);

    let card = &today(&core).await.unwrap().today[0];
    assert!(card.items.is_empty() && card.questions.is_empty() && card.handed_off.is_empty());
    assert_eq!(card.open_count, 0);
}

#[tokio::test]
async fn an_item_on_two_matching_calls_appears_once() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(granted(vec![event(
            "e1",
            "Sync",
            NOW + HOUR,
            &["Anna Koval", "Bob Ray"],
        )])),
    );
    people_world(&core);
    // Anna and Bob both spoke on `new`: its rows match through two people.
    insert(&core, vec![speaker("s5", "new", "Bob Ray", "per_bob")]);

    let card = &today(&core).await.unwrap().today[0];
    let n = ids(&card.items).iter().filter(|i| **i == "i_new").count();
    assert_eq!(n, 1);
}

async fn rank(dir: &Path, ranking: TodayRanking) -> Vec<String> {
    let (core, _) = open_with(
        dir,
        Some(granted(vec![event(
            "e1",
            "1:1 Anna",
            NOW + HOUR,
            &["Anna Koval"],
        )])),
    );
    let mut settings = core.settings_get(&ctx(), NoArgs {}).await.unwrap().today;
    settings.ranking = ranking;
    core.settings_update(
        &window(WindowLabel::Settings),
        SettingsUpdateArgs {
            rev: Rev(1),
            section: SettingsSection::Today(settings),
        },
    )
    .await
    .unwrap();
    insert(
        &core,
        vec![
            call("c_old", NOW - 9 * DAY, "ready"),
            call("c_new", NOW - 2 * DAY, "ready"),
            speaker("a1", "c_old", "Anna Koval", "per_anna"),
            speaker("a2", "c_new", "Anna Koval", "per_anna"),
            item("plain_late", "c_new", "decision", "open", "accepted"),
            item("owed_late", "c_new", "action_item", "open", "accepted"),
            item("owed_soon", "c_old", "action_item", "open", "accepted"),
            item("plain_soon", "c_old", "decision", "open", "accepted"),
        ],
    );
    exec(
        dir,
        "UPDATE items SET owner_person_id = 'per_anna' WHERE id IN ('owed_late', 'owed_soon');
         UPDATE items SET due_date = '2026-10-20' WHERE id IN ('owed_soon', 'plain_soon');
         UPDATE items SET due_date = '2026-10-30' WHERE id IN ('owed_late', 'plain_late');",
    );
    let card = today(&core).await.unwrap().today.remove(0);
    card.items
        .into_iter()
        .map(|i| i.id.as_str().to_string())
        .collect()
}

#[tokio::test]
async fn ranking_owed_to_todays_people_then_due_then_age() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        rank(dir.path(), TodayRanking::OwedToTodaysPeople).await,
        ["owed_soon", "owed_late", "plain_soon", "plain_late"]
    );
}

#[tokio::test]
async fn ranking_due_date_then_owed_to_you() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        rank(dir.path(), TodayRanking::DueThenOwedToYou).await,
        ["owed_soon", "plain_soon", "owed_late", "plain_late"]
    );
}

#[tokio::test]
async fn calendar_not_asked_or_denied_keeps_the_item_sections() {
    for (access, shown) in [
        (PermissionState::NotAsked, CalendarAccess::NotAsked),
        (PermissionState::Denied, CalendarAccess::Denied),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let (core, _) = open_with(
            dir.path(),
            Some(Calendar {
                access,
                events: Ok(vec![event("e", "Hidden", NOW + HOUR, &[])]),
            }),
        );
        people_world(&core);
        exec(
            dir.path(),
            "UPDATE items SET due_date = '2026-10-15' WHERE id = 'i_new'",
        );

        let view = today(&core).await.unwrap();
        assert_eq!(view.calendar, shown);
        assert!(view.today.is_empty() && view.this_week.is_empty());
        assert_eq!(ids(&view.due_without_call), ["i_new"]);
    }
}

#[tokio::test]
async fn a_failed_calendar_read_is_calendar_unavailable() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(Calendar {
            access: PermissionState::Granted,
            events: Err(()),
        }),
    );
    let err = today(&core).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::CalendarUnavailable);
}

#[tokio::test]
async fn sections_for_due_done_review_live_call_and_events_by_day() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(granted(vec![
            event("e_today", "Standup", NOW + HOUR, &[]),
            event("e_week", "Review", NOW + 2 * DAY, &[]),
            event("e_far", "Beyond", NOW + 9 * DAY, &[]),
        ])),
    );
    people_world(&core);
    insert(&core, vec![call("live", NOW - HOUR, "recording")]);
    exec(
        dir.path(),
        "UPDATE items SET due_date = '2026-10-15' WHERE id = 'i_new';
         UPDATE items SET due_date = '2026-10-16' WHERE id = 'i_mid';
         UPDATE items SET due_date = '2026-10-17' WHERE id = 'i_old';
         UPDATE items SET done_at = 1792137000000 WHERE id = 'i_done';
         UPDATE calls SET calendar_event_id = 'e_today' WHERE id = 'bob';",
    );

    let view = today(&core).await.unwrap();
    assert_eq!(view.date.0, "2026-10-16");
    assert_eq!(view.live_call.as_ref().unwrap().id.as_str(), "live");
    assert_eq!(view.today.len(), 1);
    assert_eq!(view.today[0].call_id.as_ref().unwrap().as_str(), "bob");
    assert_eq!(view.this_week[0].title, "Review");
    assert_eq!(view.this_week.len(), 1, "the horizon is a week");
    let mut due = ids(&view.due_without_call);
    due.sort();
    assert_eq!(
        due,
        ["i_mid", "i_new"],
        "due today or overdue, open and accepted"
    );
    assert_eq!(ids(&view.done_today), ["i_done"]);
    assert_eq!(view.review_waiting, 1);
    assert!(!view.first_use);
    assert_eq!(view.ranking, TodayRanking::OwedToTodaysPeople);
}

#[tokio::test]
async fn an_empty_core_is_first_use_without_invented_work() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let view = today(&core).await.unwrap();
    assert!(view.first_use && view.today.is_empty() && view.due_without_call.is_empty());
    assert_eq!(view.calendar, CalendarAccess::NotAsked);
    assert_eq!(view.review_waiting, 0);
}

#[tokio::test]
async fn reading_today_never_changes_an_item() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(
        dir.path(),
        Some(granted(vec![event(
            "e1",
            "1:1 Anna",
            NOW + HOUR,
            &["Anna Koval"],
        )])),
    );
    people_world(&core);
    today(&core).await.unwrap();
    assert_eq!(count(&core, "changes"), 0);
}
