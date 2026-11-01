//! FEATURE cpt-noter-feature-core-library-calls: the Library list, the call record, edits with a
//! revision, call types and deleting calls for good, over rows written the way capture writes them.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::rusqlite::Connection;
use noter_db::Insert;
use noter_protocol::ipc::{event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;
const DAY: i64 = 86_400_000;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn entity(&self) -> Vec<Value> {
        let mut all = self.0.lock().unwrap();
        let taken = std::mem::take(&mut *all);
        taken
            .into_iter()
            .filter(|(e, _)| *e == event_names::ENTITY_CHANGED)
            .map(|(_, p)| p)
            .collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

fn open(dir: &Path) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone());
    (Core::open(dir, deps).expect("core opens"), events)
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn row(table: &'static str, values: &[(&'static str, Value)]) -> Insert {
    Insert {
        table,
        values: values.to_vec(),
    }
}

/// A call row; `ended` is `None` for a call still recording.
fn call(id: &str, started: i64, ended: Option<i64>, kind: &str, status: &str) -> Insert {
    row(
        "calls",
        &[
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            ("ended_at", json!(ended)),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!(kind)),
            ("status", json!(status)),
            ("mode_used", json!("cloud_redacted")),
        ],
    )
}

fn segment(call_id: &str, n: u32, speaker: &str, lang: &str, t0: i64) -> Insert {
    row(
        "segments",
        &[
            ("id", json!(format!("seg_{call_id}_{n}"))),
            ("call_id", json!(call_id)),
            ("speaker_id", json!(speaker)),
            ("channel", json!("sys")),
            ("t0_ms", json!(t0)),
            ("t1_ms", json!(t0 + 5000)),
            ("text", json!("Hello")),
            ("text_norm", json!("hello")),
            ("lang", json!(lang)),
            ("pass", json!("live")),
        ],
    )
}

fn speaker(call_id: &str, id: &str, label: &str, n: Option<u32>, channel: &str) -> Insert {
    row(
        "speakers",
        &[
            ("id", json!(id)),
            ("call_id", json!(call_id)),
            ("label", json!(label)),
            ("n", json!(n)),
            ("channel", json!(channel)),
            ("pass", json!("live")),
        ],
    )
}

/// Three calls: a recording one now, and two older finished ones.
fn seed(core: &Core) {
    let mut rows = vec![
        call(
            "call_a",
            NOW - DAY,
            Some(NOW - DAY + 600_000),
            "planning",
            "ready",
        ),
        call(
            "call_b",
            NOW - 2 * DAY,
            Some(NOW - 2 * DAY + 1_800_000),
            "standup",
            "ready",
        ),
        call("call_c", NOW - 600_000, None, "planning", "recording"),
    ];
    rows.extend([
        speaker("call_a", "spk_a_you", "you", None, "mic"),
        speaker("call_a", "spk_a_3", "spk_3", Some(3), "sys"),
        segment("call_a", 1, "spk_a_3", "ru", 1000),
        segment("call_a", 2, "spk_a_you", "en", 9000),
        segment("call_a", 3, "spk_a_3", "ru", 12_000),
        row(
            "marks",
            &[
                ("id", json!("mrk_1")),
                ("call_id", json!("call_a")),
                ("at_ms", json!(5000)),
                ("note", json!("decision")),
            ],
        ),
        row(
            "gaps",
            &[
                ("call_id", json!("call_a")),
                ("t0_ms", json!(20_000)),
                ("t1_ms", json!(25_000)),
                ("reason", json!("paused")),
            ],
        ),
        row(
            "call_tags",
            &[
                ("call_id", json!("call_a")),
                ("tag", json!("VHI-8.0")),
                ("tag_norm", json!("vhi-8.0")),
            ],
        ),
    ]);
    core.store().insert_batch(rows).unwrap();
}

fn list_args(
    filter: CallFilter,
    sort: CallSort,
    limit: Option<u32>,
    cursor: Option<Cursor>,
) -> CallsListArgs {
    CallsListArgs {
        filter,
        sort,
        page: PageRequest { cursor, limit },
    }
}

async fn ids(core: &Core, filter: CallFilter, sort: CallSort) -> Vec<String> {
    let page = core
        .calls_list(&main_window(), list_args(filter, sort, None, None))
        .await
        .unwrap();
    page.rows.into_iter().map(|r| r.id.0).collect()
}

fn changes(dir: &Path, reason: &str) -> Vec<(String, String, bool, Option<String>)> {
    let c = Connection::open(dir.join("noter.db")).unwrap();
    let mut s = c
        .prepare("SELECT entity_type, entity_id, undoable, field FROM changes WHERE reason = ?1 ORDER BY rowid")
        .unwrap();
    let rows = s
        .query_map([reason], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .unwrap();
    rows.map(Result::unwrap).collect()
}

#[tokio::test]
async fn the_list_shows_the_newest_call_first_with_its_derived_fields() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let page = core
        .calls_list(
            &main_window(),
            list_args(CallFilter::default(), CallSort::Newest, None, None),
        )
        .await
        .unwrap();
    let order: Vec<_> = page.rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(order, ["call_c", "call_a", "call_b"]);
    assert_eq!(page.total, Some(3));
    assert_eq!(page.next_cursor, None);
    let a = &page.rows[1];
    assert_eq!(a.duration_ms, DurationMs(600_000));
    assert_eq!(a.languages, vec![Lang::Ru, Lang::En]);
    assert_eq!(a.unnamed_speakers, 1);
    assert_eq!(a.tags, vec!["VHI-8.0".to_string()]);
    assert_eq!(
        (a.status, a.privacy),
        (CallStatus::Ready, PrivacyClass::Normal)
    );
    assert_eq!(a.outputs, OutputsStatus::NotStarted);
    assert!(a.participants.is_empty() && a.open_items == 0 && a.review_waiting == 0);
    // A call still recording lasts until the clock's now.
    assert_eq!(page.rows[0].duration_ms, DurationMs(600_000));
    assert_eq!(page.rows[0].status, CallStatus::Recording);
}

#[tokio::test]
async fn sorts_and_cursor_pages_cover_every_call_once() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    assert_eq!(
        ids(&core, CallFilter::default(), CallSort::Oldest).await,
        ["call_b", "call_a", "call_c"]
    );
    assert_eq!(
        ids(&core, CallFilter::default(), CallSort::Longest).await,
        ["call_b", "call_c", "call_a"]
    );
    assert_eq!(
        ids(&core, CallFilter::default(), CallSort::Title).await,
        ["call_a", "call_b", "call_c"]
    );
    for sort in [
        CallSort::Newest,
        CallSort::Oldest,
        CallSort::Longest,
        CallSort::Title,
    ] {
        let whole = ids(&core, CallFilter::default(), sort).await;
        let mut paged = vec![];
        let mut cursor = None;
        loop {
            let page = core
                .calls_list(
                    &main_window(),
                    list_args(CallFilter::default(), sort, Some(2), cursor),
                )
                .await
                .unwrap();
            assert!(page.rows.len() <= 2);
            paged.extend(page.rows.into_iter().map(|r| r.id.0));
            cursor = page.next_cursor;
            if cursor.is_none() {
                break;
            }
        }
        assert_eq!(paged, whole, "{sort:?}");
    }
}

#[tokio::test]
async fn filters_narrow_the_list_in_sql() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let only = |f: CallFilter| ids(&core, f, CallSort::Newest);
    let planning = CallFilter {
        call_types: vec![CallTypeId("planning".into())],
        ..CallFilter::default()
    };
    assert_eq!(only(planning).await, ["call_c", "call_a"]);
    let english = CallFilter {
        languages: vec![Lang::En],
        ..CallFilter::default()
    };
    assert_eq!(only(english).await, ["call_a"]);
    let tagged = CallFilter {
        tags: vec!["vhi-8.0".into()],
        ..CallFilter::default()
    };
    assert_eq!(only(tagged).await, ["call_a"]);
    // `NOW` is 2026-10-16 UTC; call_a started on the 15th, call_b on the 14th.
    let day = |from: Option<&str>, to: Option<&str>| CallFilter {
        from: from.map(|d| LocalDate(d.into())),
        to: to.map(|d| LocalDate(d.into())),
        ..CallFilter::default()
    };
    assert_eq!(
        only(day(Some("2026-10-15"), Some("2026-10-15"))).await,
        ["call_a"]
    );
    assert_eq!(
        only(day(Some("2026-10-15"), None)).await,
        ["call_c", "call_a"]
    );
    assert_eq!(only(day(None, Some("2026-10-14"))).await, ["call_b"]);
    let none = CallFilter {
        has_open_items: Some(true),
        ..CallFilter::default()
    };
    assert!(only(none).await.is_empty());
}

#[tokio::test]
async fn a_bad_filter_or_cursor_is_invalid_input() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let bad_filters = [
        CallFilter {
            call_types: vec![CallTypeId("nonsense".into())],
            ..CallFilter::default()
        },
        CallFilter {
            from: Some(LocalDate("2026-13-40".into())),
            ..CallFilter::default()
        },
        CallFilter {
            from: Some(LocalDate("2026-10-16".into())),
            to: Some(LocalDate("2026-10-15".into())),
            ..CallFilter::default()
        },
    ];
    for filter in bad_filters {
        let err = core
            .calls_list(
                &main_window(),
                list_args(filter, CallSort::Newest, None, None),
            )
            .await
            .unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidInput);
    }
    let err = core
        .calls_list(
            &main_window(),
            list_args(
                CallFilter::default(),
                CallSort::Newest,
                None,
                Some(Cursor("garbage".into())),
            ),
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[tokio::test]
async fn call_get_serves_the_record_with_speakers_marks_and_gaps() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let detail = core
        .call_get(
            &main_window(),
            CallIdArgs {
                call_id: CallId::new("call_a"),
            },
        )
        .await
        .unwrap();
    assert_eq!(detail.call.id.as_str(), "call_a");
    assert_eq!(detail.mode_used, EffectiveMode::CloudRedacted);
    assert_eq!(
        std::path::Path::new(&detail.folder),
        dir.path().join("audio").join("call_a"),
        "the call's folder, for Show in Finder"
    );
    assert!(!detail.audio_not_stored && detail.calendar_event.is_none());
    let labels: Vec<_> = detail
        .speakers
        .iter()
        .map(|s| (s.id.as_str(), s.label.clone(), s.segment_count))
        .collect();
    assert_eq!(
        labels,
        [
            ("spk_a_you", SpeakerLabel::You, 1),
            ("spk_a_3", SpeakerLabel::Unnamed { n: 3 }, 2),
        ]
    );
    assert_eq!(
        detail.speakers[1]
            .sample
            .as_ref()
            .map(|s| (s.t0_ms, s.t1_ms)),
        Some((OffsetMs(1000), OffsetMs(6000)))
    );
    assert!(detail.speakers[0].sample.is_none());
    assert_eq!(detail.marks.len(), 1);
    assert_eq!(detail.marks[0].note.as_deref(), Some("decision"));
    assert_eq!(detail.gaps.len(), 1);
    assert_eq!(detail.gaps[0].reason, GapReason::Paused);
}

#[tokio::test]
async fn a_missing_call_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    let err = core
        .call_get(
            &main_window(),
            CallIdArgs {
                call_id: CallId::new("call_gone"),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn an_unclassified_call_passes_through_and_stays_out_of_the_types() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    core.store()
        .insert_batch(vec![call(
            "call_u",
            NOW - DAY,
            Some(NOW),
            "unclassified",
            "ready",
        )])
        .unwrap();
    let got = core
        .call_get(
            &main_window(),
            CallIdArgs {
                call_id: CallId::new("call_u"),
            },
        )
        .await
        .unwrap();
    assert_eq!(got.call.call_type.0.as_str(), "unclassified");
    let types = core
        .call_types_list(&main_window(), NoArgs {})
        .await
        .unwrap();
    assert!(types.call_types.iter().all(|t| t.id.0 != "unclassified"));
}

#[tokio::test]
async fn call_update_renames_with_the_rev_guard_and_broadcasts() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);
    let update = |rev, title: Option<&str>, kind: Option<&str>| CallUpdateArgs {
        call_id: CallId::new("call_a"),
        rev: Rev(rev),
        title: title.map(String::from),
        call_type: kind.map(|k| CallTypeId(k.into())),
    };
    let done = core
        .call_update(&main_window(), update(1, Some("Renamed"), Some("retro")))
        .await
        .unwrap();
    assert_eq!(
        (
            done.call.title.as_str(),
            done.call.call_type.0.as_str(),
            done.call.rev
        ),
        ("Renamed", "retro", Rev(2))
    );
    let sent = events.entity();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        (sent[0]["type"].as_str(), sent[0]["call"]["title"].as_str()),
        (Some("call"), Some("Renamed"))
    );
    assert_eq!(changes(dir.path(), "call_update").len(), 1);

    let stale = core
        .call_update(&main_window(), update(1, Some("Again"), None))
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    assert!(events.entity().is_empty());

    for bad in [
        update(2, Some("  "), None),
        update(2, None, Some("nonsense")),
        update(2, None, None),
    ] {
        let err = core.call_update(&main_window(), bad).await.unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidInput);
    }
    let missing = CallUpdateArgs {
        call_id: CallId::new("call_gone"),
        ..update(1, Some("x"), None)
    };
    assert_eq!(
        core.call_update(&main_window(), missing)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn call_types_are_the_eight_built_ins_plus_readable_user_folders() {
    let dir = tempfile::tempdir().unwrap();
    let skills = dir.path().join("skills");
    std::fs::create_dir_all(skills.join("sales_review")).unwrap();
    std::fs::write(skills.join("sales_review/SKILL.md"), "# Sales review").unwrap();
    // Unreadable: SKILL.md is a directory.
    std::fs::create_dir_all(skills.join("broken/SKILL.md")).unwrap();
    // A user folder never shadows a built-in.
    std::fs::create_dir_all(skills.join("standup")).unwrap();
    std::fs::write(skills.join("standup/SKILL.md"), "# mine").unwrap();
    let (core, _) = open(dir.path());
    let types = core
        .call_types_list(&main_window(), NoArgs {})
        .await
        .unwrap()
        .call_types;
    let built_in: Vec<_> = types
        .iter()
        .filter(|t| t.builtin)
        .map(|t| t.id.0.as_str())
        .collect();
    assert_eq!(
        built_in,
        [
            "one_on_one",
            "standup",
            "planning",
            "retro",
            "cross_team",
            "vendor",
            "interview",
            "incident"
        ]
    );
    assert_eq!(types[0].label, "one on one");
    assert_eq!(types[0].skill_path, "skills/one_on_one/SKILL.md");
    let user: Vec<_> = types.iter().filter(|t| !t.builtin).collect();
    assert_eq!(user.len(), 1);
    assert_eq!(user[0].id.0.as_str(), "sales_review");
    assert!(user[0].skill_path.ends_with("skills/sales_review/SKILL.md"));
}

#[tokio::test]
async fn delete_removes_the_call_and_its_files_and_logs_one_change_without_content() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);
    std::fs::create_dir_all(dir.path().join("audio/call_a")).unwrap();
    std::fs::write(dir.path().join("audio/call_a/mic.m4a"), b"x").unwrap();
    std::fs::create_dir_all(dir.path().join("audio/call_b")).unwrap();
    let args = CallsDeleteArgs {
        call_ids: vec![
            CallId::new("call_a"),
            CallId::new("call_gone"),
            CallId::new("call_b"),
        ],
    };
    let done = core.calls_delete(&main_window(), args).await.unwrap();
    assert_eq!(done.deleted, 2);
    assert!(!dir.path().join("audio/call_a").exists() && !dir.path().join("audio/call_b").exists());
    assert_eq!(
        ids(&core, CallFilter::default(), CallSort::Newest).await,
        ["call_c"]
    );
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    for table in ["segments", "speakers", "marks", "gaps", "call_tags"] {
        let n: u32 = c
            .query_row(
                &format!("SELECT count(*) FROM {table} WHERE call_id = 'call_a'"),
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0, "{table}");
    }
    let log = changes(dir.path(), "calls_delete");
    assert_eq!(log.len(), 2);
    assert!(log
        .iter()
        .all(|(kind, _, undoable, field)| kind == "call" && !undoable && field.is_none()));
    let removed = events.entity();
    assert_eq!(removed.len(), 2);
    assert!(removed
        .iter()
        .all(|p| p["type"] == "removed" && p["kind"] == "call"));
    let gone = core
        .call_get(
            &main_window(),
            CallIdArgs {
                call_id: CallId::new("call_a"),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(gone.code, ErrorCode::NotFound);
}

#[tokio::test]
async fn the_call_being_recorded_is_not_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core);
    let mut live = core
        .app_snapshot(&main_window(), NoArgs {})
        .await
        .unwrap()
        .capture;
    live.phase = CapturePhase::Recording;
    live.call_id = Some(CallId::new("call_c"));
    live.started_at = Some(TimestampMs(NOW - 600_000));
    noter_core::testing::seed_capture(&core, live)
        .await
        .unwrap();
    let args = CallsDeleteArgs {
        call_ids: vec![CallId::new("call_a"), CallId::new("call_c")],
    };
    let err = core.calls_delete(&main_window(), args).await.unwrap_err();
    assert_eq!(err.code, ErrorCode::AlreadyRecording);
    assert_eq!(
        ids(&core, CallFilter::default(), CallSort::Newest)
            .await
            .len(),
        3
    );
    assert!(events.entity().is_empty());
}

#[tokio::test]
async fn files_that_could_not_be_removed_are_retried_at_the_next_start() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    // A plain file where the call's folder is expected cannot be removed as a folder.
    std::fs::create_dir_all(dir.path().join("audio")).unwrap();
    std::fs::write(dir.path().join("audio/call_b"), b"not a folder").unwrap();
    let args = CallsDeleteArgs {
        call_ids: vec![CallId::new("call_b")],
    };
    assert_eq!(
        core.calls_delete(&main_window(), args)
            .await
            .unwrap()
            .deleted,
        1
    );
    assert!(dir.path().join("audio/call_b").exists());
    core.shutdown().await;
    drop(core);
    std::fs::remove_file(dir.path().join("audio/call_b")).unwrap();
    std::fs::create_dir_all(dir.path().join("audio/call_b")).unwrap();
    let (_again, _) = open(dir.path());
    assert!(!dir.path().join("audio/call_b").exists());
}

#[tokio::test]
async fn a_call_row_carries_the_audio_retention_days_and_no_deletion_time_while_audio_is_kept() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core);
    let days = || async {
        let detail = core
            .call_get(
                &main_window(),
                CallIdArgs {
                    call_id: CallId::new("call_a"),
                },
            )
            .await
            .unwrap();
        (
            detail.call.audio_retention_days,
            detail.call.audio_deleted_at,
        )
    };
    assert_eq!(days().await, (30, None), "the default retention");

    let db = Connection::open(dir.path().join("noter.db")).unwrap();
    for (word, expected) in [
        ("days7", 7),
        ("days90", 90),
        ("forever", 0),
        ("never_store", 0),
    ] {
        let value = json!({ "retention": word }).to_string();
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('audio', ?1)",
            [value],
        )
        .unwrap();
        assert_eq!(days().await.0, expected, "{word}");
    }
}
