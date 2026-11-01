//! FEATURE cpt-noter-feature-core-speakers-audio (slice 3): `audio_delete` and
//! `audio_delete_older`: stored audio goes, the transcript stays, the change is not undoable.

use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_db::Insert;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_792_137_600_000;
const DAY: i64 = 86_400_000;
const MIB: usize = 1_048_576;

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
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

fn ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

fn call(id: &str, age_days: i64, status: &str, not_stored: bool) -> Insert {
    let started = NOW - age_days * DAY;
    Insert {
        table: "calls",
        values: vec![
            ("id", json!(id)),
            ("rev", json!(1)),
            ("started_at", json!(started)),
            (
                "ended_at",
                json!(if status == "ready" {
                    Some(started + 3_000_000)
                } else {
                    None
                }),
            ),
            ("title", json!(format!("Call {id}"))),
            ("call_type", json!("planning")),
            ("status", json!(status)),
            ("audio_not_stored", json!(not_stored)),
            ("mode_used", json!("cloud_redacted")),
        ],
    }
}

/// `old` (40 days), `fresh` (2 days), `live` (recording), `nostore` (40 days, never stored).
fn seed(core: &Core, dir: &Path) {
    core.store()
        .insert_batch(vec![
            call("old", 40, "ready", false),
            call("fresh", 2, "ready", false),
            call("live", 40, "recording", false),
            call("nostore", 40, "ready", true),
        ])
        .unwrap();
    for (id, mib) in [("old", 3), ("fresh", 1), ("live", 1)] {
        let folder = dir.join("audio").join(id);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("mic.1.aac"), vec![0u8; mib * MIB]).unwrap();
        std::fs::write(folder.join("sys.1.aac"), vec![0u8; 10]).unwrap();
        std::fs::write(folder.join("transcript.jsonl"), "{}\n").unwrap();
        std::fs::write(folder.join("constraints.json"), "{}").unwrap();
    }
}

fn files(dir: &Path, id: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(dir.join("audio").join(id))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn row(core: &Core, id: &'static str) -> (bool, Option<i64>) {
    core.store()
        .read(move |c| {
            c.query_row(
                "SELECT audio_deleted, audio_deleted_at FROM calls WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .unwrap()
}

async fn delete(core: &Core, ids: &[&str]) -> Result<DeleteAudioResult, CoreError> {
    core.audio_delete(
        &ctx(),
        DeleteAudioArgs {
            call_ids: ids.iter().map(|i| CallId::new(*i)).collect(),
        },
    )
    .await
}

async fn older(core: &Core, days: u16) -> Result<DeleteAudioResult, CoreError> {
    core.audio_delete_older(
        &ctx(),
        DeleteOldAudioArgs {
            older_than_days: days,
        },
    )
    .await
}

#[tokio::test]
async fn deleting_audio_keeps_the_transcript_reports_the_freed_space_and_cannot_be_undone() {
    let dir = tempfile::tempdir().unwrap();
    let (core, events) = open(dir.path());
    seed(&core, dir.path());

    let done = delete(&core, &["old", "old"]).await.unwrap();

    assert_eq!(
        (done.calls, done.freed_mb),
        (1, 3),
        "deduplicated, bytes actually removed"
    );
    assert_eq!(
        files(dir.path(), "old"),
        ["constraints.json", "transcript.jsonl"]
    );
    assert_eq!(
        files(dir.path(), "fresh").len(),
        4,
        "another call is untouched"
    );
    assert_eq!(row(&core, "old"), (true, Some(NOW)));
    let published = events.0.lock().unwrap().iter().any(|(e, p)| {
        *e == "entity:changed" && p["type"] == "call" && p["call"]["audio_deleted_at"] == json!(NOW)
    });
    assert!(published, "the call is published with its deletion time");

    let played = core
        .audio_play(
            &ctx(),
            PlayAudioArgs {
                call_id: CallId::new("old"),
                from_ms: OffsetMs(0),
                to_ms: None,
                channel: None,
            },
        )
        .await;
    assert_eq!(played.unwrap_err().code, ErrorCode::AudioDeleted);

    // The change row names no audio and refuses to be undone.
    let page = core
        .history_list(
            &ctx(),
            HistoryListArgs {
                target: HistoryTarget::All,
                actor: ActorFilter::All,
                job_id: None,
                from: None,
                to: None,
                page: PageRequest {
                    cursor: None,
                    limit: None,
                },
            },
        )
        .await
        .unwrap();
    let change = &page.rows[0];
    assert!(!change.undoable);
    let undone = core
        .change_undo(
            &ctx(),
            UndoArgs {
                target: UndoTarget::Change {
                    change_id: change.id.clone(),
                },
            },
        )
        .await;
    assert_eq!(undone.unwrap_err().code, ErrorCode::NotUndoable);
}

#[tokio::test]
async fn deleting_twice_or_deleting_audio_that_was_never_stored_counts_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, dir.path());
    delete(&core, &["old"]).await.unwrap();

    let again = delete(&core, &["old", "nostore"]).await.unwrap();

    assert_eq!((again.calls, again.freed_mb), (0, 0));
    assert_eq!(
        row(&core, "nostore"),
        (false, None),
        "never stored stays not deleted"
    );
}

#[tokio::test]
async fn deleting_refuses_a_live_call_and_an_unknown_one_before_touching_anything() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, dir.path());

    let live = delete(&core, &["old", "live"]).await.unwrap_err();
    assert_eq!(live.code, ErrorCode::InvalidInput);
    let unknown = delete(&core, &["nope"]).await.unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound);

    assert_eq!(files(dir.path(), "old").len(), 4, "nothing was removed");
    assert_eq!(row(&core, "old"), (false, None));
}

#[tokio::test]
async fn deleting_by_age_takes_only_old_stored_calls_and_never_a_live_one() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, dir.path());

    let done = older(&core, 30).await.unwrap();

    assert_eq!((done.calls, done.freed_mb), (1, 3));
    assert!(row(&core, "old").0);
    assert!(!row(&core, "fresh").0, "too recent");
    assert!(!row(&core, "live").0, "capturing");
    assert_eq!(files(dir.path(), "live").len(), 4);
    assert_eq!(
        older(&core, 30).await.unwrap().calls,
        0,
        "nothing left to take"
    );
    assert_eq!(
        older(&core, 0).await.unwrap_err().code,
        ErrorCode::InvalidInput
    );
}

#[tokio::test]
async fn a_file_that_cannot_be_removed_keeps_the_audio_available_and_a_retry_finishes() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open(dir.path());
    seed(&core, dir.path());
    // A directory where a file belongs: removal fails for this one name.
    let blocker = dir.path().join("audio/old/sys.1.aac");
    std::fs::remove_file(&blocker).unwrap();
    std::fs::create_dir(&blocker).unwrap();
    std::fs::write(blocker.join("keep"), "x").unwrap();

    let failed = delete(&core, &["old"]).await.unwrap_err();

    assert_eq!(failed.code, ErrorCode::Internal);
    assert_eq!(
        row(&core, "old"),
        (false, None),
        "availability stays truthful"
    );

    std::fs::remove_dir_all(&blocker).unwrap();
    let retried = delete(&core, &["old"]).await.unwrap();
    assert_eq!(
        retried.calls, 1,
        "the retry tolerates the file already removed"
    );
    assert_eq!(row(&core, "old"), (true, Some(NOW)));
}
