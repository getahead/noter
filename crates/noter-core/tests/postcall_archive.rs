//! FEATURE cpt-noter-feature-core-postcall, slice 2: chunks and embeddings of the transcript,
//! suggested items with their evidence, the merge regeneration, the archive pass and the
//! Summary-ready notification. The scripted runtime and the scripted engine answer; paused time.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{
    Adapters, Clock, Core, CoreDeps, EventEmitter, Notification, NotificationKind, Placement,
    Scripted, Surfaces, TrayModel,
};
use noter_db::Insert;
use noter_engine_client::scripted::ScriptedEngine;
use noter_jobs::{Request, Trigger};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

const NOW: i64 = 1_790_000_000_000;
const CALL: &str = "call_pc";

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(NOW)
    }
}

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn entity(&self) -> Vec<Value> {
        let all = self.0.lock().unwrap();
        all.iter()
            .filter(|(e, _)| *e == "entity:changed")
            .map(|(_, p)| p.clone())
            .collect()
    }
}

/// The native layer: only what was posted matters here.
#[derive(Default)]
struct Posted(Mutex<Vec<Notification>>);

impl Surfaces for Posted {
    fn show_record_prompt(&self) {}
    fn close_record_prompt(&self) {}
    fn show_call_window(&self, _: &Placement) {}
    fn make_call_window_key(&self) {}
    fn place_call_window(&self, _: &Placement, _: bool) {}
    fn hide_call_window(&self) {}
    fn hide_all(&self) {}
    fn restore_all(&self) {}
    fn set_tray(&self, _: &TrayModel) {}
    fn announce(&self, _: &str, _: Politeness) {}
    fn open_external(&self, _: &ExternalTarget) {}
    fn show_window(&self, _: WindowLabel) {}
    fn call_surface_visible(&self) -> bool {
        false
    }
    fn post_notification(&self, n: &Notification) {
        self.0.lock().unwrap().push(n.clone());
    }
}

struct Rig {
    core: Arc<Core>,
    events: Arc<Events>,
    posted: Arc<Posted>,
    dir: tempfile::TempDir,
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// A core whose router answers from `script` and whose engine is scripted, with an App Group
/// container (`engine: true`) or without one.
async fn open(script: &str, engine: bool) -> Rig {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let posted = Arc::new(Posted::default());
    let scripted = Scripted::parse(script).unwrap();
    let mut deps = CoreDeps::new(Arc::new(FixedClock), events.clone())
        .with_llm(Adapters::scripted(&scripted))
        .with_surfaces(posted.clone());
    if engine {
        deps = deps.with_engine(Arc::new(ScriptedEngine::new().with_container(dir.path())));
    }
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    Rig {
        core,
        events,
        posted,
        dir,
    }
}

fn ins(table: &'static str, values: Vec<(&'static str, Value)>) -> Insert {
    Insert { table, values }
}

/// A stopped planning call, still `processing`, with `segments` live segments of a speaker the
/// user named.
fn seed_call(core: &Core, id: &str, segments: i64) {
    let mut rows = vec![
        ins(
            "calls",
            vec![
                ("id", json!(id)),
                ("rev", json!(1)),
                ("started_at", json!(NOW - 3_600_000)),
                ("ended_at", json!(NOW - 60_000)),
                ("title", json!("Planning")),
                ("call_type", json!("planning")),
                ("status", json!("processing")),
                ("mode_used", json!("cloud")),
            ],
        ),
        ins(
            "speakers",
            vec![
                ("id", json!(format!("{id}_spk"))),
                ("call_id", json!(id)),
                ("label", json!("Anna Lee")),
                ("n", json!(1)),
                ("channel", json!("sys")),
                ("pass", json!("live")),
                ("named_by", json!("you")),
                ("person_id", json!("per_anna")),
            ],
        ),
    ];
    for n in 0..segments {
        rows.push(ins(
            "segments",
            vec![
                ("id", json!(format!("{id}_seg_{n}"))),
                ("call_id", json!(id)),
                ("speaker_id", json!(format!("{id}_spk"))),
                ("channel", json!("sys")),
                ("t0_ms", json!(n * 10_000)),
                ("t1_ms", json!(n * 10_000 + 5_000)),
                ("text", json!(format!("We agree on step {n}."))),
                ("text_norm", json!(format!("we agree on step {n}."))),
                ("lang", json!("en")),
                ("pass", json!("live")),
            ],
        ));
    }
    core.store().insert_batch(rows).unwrap();
}

fn trigger(core: &Core, kind: JobKind, id: &str) -> JobRunId {
    let on = if kind == JobKind::Regeneration {
        Trigger::OnDemand
    } else {
        Trigger::AfterCall
    };
    let req = Request::for_call(kind, on, &CallId::new(id));
    core.scheduler().trigger(req).unwrap().expect("queued")
}

async fn settle(core: &Core, run: &JobRunId) -> JobRunRow {
    for _ in 0..600 {
        let row = core
            .scheduler()
            .runs()
            .unwrap()
            .into_iter()
            .find(|r| &r.id == run)
            .unwrap();
        if matches!(
            row.status,
            JobRunStatus::Succeeded | JobRunStatus::Failed | JobRunStatus::Cancelled
        ) {
            return row;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    panic!("the run never ended");
}

async fn outputs(core: &Core, id: &str) -> CallOutputs {
    core.outputs_get(
        &main_window(),
        CallIdArgs {
            call_id: CallId::new(id),
        },
    )
    .await
    .unwrap()
}

fn rows(core: &Core, sql: &str) -> Vec<Vec<Value>> {
    use noter_db::rusqlite::types::ValueRef;
    let sql = sql.to_owned();
    core.store()
        .read(move |c| {
            let mut stmt = c.prepare(&sql)?;
            let n = stmt.column_count();
            let rows = stmt.query_map([], |r| {
                (0..n)
                    .map(|i| {
                        Ok(match r.get_ref(i)? {
                            ValueRef::Null => Value::Null,
                            ValueRef::Integer(v) => json!(v),
                            ValueRef::Real(v) => json!(v),
                            ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                            ValueRef::Blob(b) => json!(b.len()),
                        })
                    })
                    .collect()
            })?;
            rows.collect()
        })
        .unwrap()
}

/// A post-call output whose summary and extras are `summary` and `extras`, with no items.
fn output(summary: &str, extras: &str) -> String {
    json!({"on": "post-call", "output": {
        "lang": "en", "summary_md": summary, "decisions": [], "action_items": [],
        "open_questions": [], "risks": [], "per_participant": [], "extras_md": extras
    }})
    .to_string()
}

#[tokio::test(start_paused = true)]
async fn post_call_chunks_and_embeds_the_live_transcript_before_the_sections() {
    let r = open("", true).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    assert_eq!(settle(&r.core, &run).await.status, JobRunStatus::Succeeded);
    let chunks = rows(
        &r.core,
        "SELECT call_id, t0_ms, t1_ms, text, token_count, embedding FROM chunks",
    );
    assert_eq!(chunks.len(), 1, "three short lines are one chunk");
    let c = &chunks[0];
    assert_eq!(c[..3], [json!(CALL), json!(0), json!(25_000)]);
    let text = c[3].as_str().unwrap();
    assert!(text.starts_with("Call: Planning · planning · "), "{text}");
    assert!(text.contains("\nAnna Lee: We agree on step 0.\n"), "{text}");
    assert!(c[4].as_i64().unwrap() > 0);
    assert_eq!(c[5], json!(1024 * 4), "one float32 vector of 1024 values");
    // The chunk write is one logged, non-undoable change of the job.
    let logged = rows(
        &r.core,
        "SELECT entity_type, field, undoable FROM changes WHERE field = 'chunks'",
    );
    assert_eq!(logged, vec![vec![json!("call"), json!("chunks"), json!(0)]]);
    // summary.md is written from the committed sections.
    let md =
        std::fs::read_to_string(r.dir.path().join(format!("audio/{CALL}/summary.md"))).unwrap();
    assert!(md.starts_with("## Summary\n\nScripted summary.\n"), "{md}");
    assert!(md.contains("## Decisions\n\n- Scripted decision"), "{md}");
}

#[tokio::test(start_paused = true)]
async fn without_embeddings_the_chunks_stay_and_the_outputs_are_still_written() {
    // No App Group container: the engine refuses every embedding.
    let r = open("", false).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    assert_eq!(settle(&r.core, &run).await.status, JobRunStatus::Succeeded);
    let chunks = rows(&r.core, "SELECT embedding FROM chunks");
    assert_eq!(chunks, vec![vec![Value::Null]]);
    assert_eq!(outputs(&r.core, CALL).await.status, OutputsStatus::Ready);
}

#[tokio::test(start_paused = true)]
async fn suggested_items_carry_their_evidence_and_reviewed_ones_are_never_suggested_again() {
    let r = open("", true).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    settle(&r.core, &run).await;
    let items = rows(
        &r.core,
        "SELECT id, kind, text, review_state, created_by FROM items ORDER BY kind",
    );
    assert_eq!(items.len(), 2);
    assert_eq!(
        items[0][1..],
        [
            json!("action_item"),
            json!("Scripted action item"),
            json!("suggested"),
            json!("llm")
        ]
    );
    assert_eq!(
        items[1][1..3],
        [json!("decision"), json!("Scripted decision")]
    );
    // Evidence: spans of call time on the cited segments' channel.
    let spans = rows(
        &r.core,
        &format!(
            "SELECT channel, t0_ms, t1_ms FROM item_spans WHERE item_id = '{}' ORDER BY t0_ms",
            items[1][0].as_str().unwrap()
        ),
    );
    assert!(!spans.is_empty());
    assert!(spans.iter().all(|s| s[0] == "sys"));
    // A rerun replaces the still-suggested items: the same two, new ids.
    let regen = trigger(&r.core, JobKind::Regeneration, CALL);
    assert_eq!(
        settle(&r.core, &regen).await.status,
        JobRunStatus::Succeeded
    );
    let again = rows(&r.core, "SELECT id, kind FROM items ORDER BY kind");
    assert_eq!(again.len(), 2);
    assert_ne!(again[0][0], items[0][0]);
    // The user accepts the action item and rejects the decision.
    for (row, decision) in [
        (&again[0], ReviewDecision::Accept),
        (&again[1], ReviewDecision::Reject),
    ] {
        r.core
            .item_review(
                &main_window(),
                ItemReviewArgs {
                    item_id: ItemId::new(row[0].as_str().unwrap()),
                    rev: Rev(1),
                    decision,
                },
            )
            .await
            .unwrap();
    }
    // Regenerating again suggests neither: the accepted one stays, the rejected one stays out.
    let regen = trigger(&r.core, JobKind::Regeneration, CALL);
    settle(&r.core, &regen).await;
    let last = rows(&r.core, "SELECT id, review_state FROM items ORDER BY kind");
    assert_eq!(
        last,
        vec![
            vec![again[0][0].clone(), json!("accepted")],
            vec![again[1][0].clone(), json!("rejected")]
        ]
    );
    // Replaced suggestions went out as removed.
    let removed = r
        .events
        .entity()
        .into_iter()
        .filter(|e| e["type"] == "removed" && e["kind"] == "item")
        .count();
    assert_eq!(removed, 2);
}

#[tokio::test(start_paused = true)]
async fn regeneration_merges_new_text_into_the_users_edit_and_keeps_the_candidate() {
    let first = output("A.\nB.\nC.\nD.", "Old extras.");
    let second = output("A.\nB.\nC.\nD2.", "New extras.");
    let script = [vec![first; 7], vec![second; 2]].concat().join("\n");
    let r = open(&script, true).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    settle(&r.core, &run).await;
    let o = outputs(&r.core, CALL).await;
    let summary = o.sections[0].summary_id.clone().unwrap();
    // The user edits the first line of the summary.
    r.core
        .output_edit(
            &main_window(),
            OutputEditArgs {
                call_id: CallId::new(CALL),
                summary_id: summary.clone(),
                rev: Rev(1),
                body_md: "A!\nB.\nC.\nD.".into(),
            },
        )
        .await
        .unwrap();
    let accepted = r
        .core
        .outputs_regenerate(
            &main_window(),
            RegenerateArgs {
                call_id: CallId::new(CALL),
                sections: vec![SectionKind::Summary, SectionKind::CallTypeExtras],
                runtime: None,
                model: None,
                skill: None,
                local: false,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        settle(&r.core, &accepted.job_run_id).await.status,
        JobRunStatus::Succeeded
    );
    let o = outputs(&r.core, CALL).await;
    // Edited: the user's line stays and the generator's change elsewhere lands.
    let s = &o.sections[0];
    assert_eq!(s.body_md.as_deref(), Some("A!\nB.\nC.\nD2."));
    assert!(s.user_edited && s.regenerated_with_edits);
    let versions = r
        .core
        .output_versions(
            &main_window(),
            SummaryIdArgs {
                summary_id: summary.clone(),
            },
        )
        .await
        .unwrap()
        .versions;
    let kinds: Vec<VersionKind> = versions.iter().map(|v| v.kind).collect();
    assert_eq!(
        kinds,
        [
            VersionKind::Generated,
            VersionKind::UserEdit,
            VersionKind::Generated,
            VersionKind::UserEdit
        ]
    );
    // The candidate stays readable for the diff.
    let candidate = r
        .core
        .output_version_get(
            &main_window(),
            VersionGetArgs {
                summary_id: summary,
                version_id: versions[2].id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(candidate.body_md, "A.\nB.\nC.\nD2.");
    // Unedited: replaced by the new text. Untouched sections keep their one version.
    let extras = o
        .sections
        .iter()
        .find(|s| s.kind == SectionKind::CallTypeExtras)
        .unwrap();
    assert_eq!(extras.body_md.as_deref(), Some("New extras."));
    assert!(!extras.regenerated_with_edits);
    assert_eq!(o.sections[1].version_count, 1);
    // The merged section went out whole.
    let sections: Vec<Value> = r
        .events
        .entity()
        .into_iter()
        .filter(|e| e["type"] == "section" && e["section"]["kind"] == "summary")
        .collect();
    assert_eq!(
        sections.last().unwrap()["section"]["body_md"],
        "A!\nB.\nC.\nD2."
    );
}

#[tokio::test(start_paused = true)]
async fn a_cancelled_regeneration_installs_nothing() {
    let slow = r#"{"on": "post-call", "after_ms": 30000}"#;
    let script = [vec![r#"{"on": "post-call"}"#; 7], vec![slow; 7]]
        .concat()
        .join("\n");
    let r = open(&script, true).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    settle(&r.core, &run).await;
    let regen = trigger(&r.core, JobKind::Regeneration, CALL);
    tokio::time::sleep(Duration::from_secs(5)).await;
    r.core.scheduler().cancel(&regen).unwrap();
    assert_eq!(
        settle(&r.core, &regen).await.status,
        JobRunStatus::Cancelled
    );
    tokio::time::sleep(Duration::from_secs(60)).await;
    let o = outputs(&r.core, CALL).await;
    assert!(o.sections.iter().all(|s| s.version_count <= 1), "{o:?}");
}

#[tokio::test(start_paused = true)]
async fn the_summary_ready_notification_waits_for_the_live_call_and_names_the_call() {
    let r = open("", true).await;
    seed_call(&r.core, CALL, 3);
    // Another call is being recorded while this one's outputs are written (D2).
    let mut live = r
        .core
        .app_snapshot(&main_window(), NoArgs {})
        .await
        .unwrap()
        .capture;
    live.phase = CapturePhase::Recording;
    live.call_id = Some(CallId::new("call_live"));
    live.started_at = Some(TimestampMs(NOW - 60_000));
    noter_core::testing::seed_capture(&r.core, live.clone())
        .await
        .unwrap();
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    assert_eq!(settle(&r.core, &run).await.status, JobRunStatus::Succeeded);
    assert!(
        r.posted.0.lock().unwrap().is_empty(),
        "held during the live call"
    );
    live.phase = CapturePhase::Idle;
    live.call_id = None;
    noter_core::testing::seed_capture(&r.core, live)
        .await
        .unwrap();
    assert_eq!(
        *r.posted.0.lock().unwrap(),
        [Notification {
            call_id: CallId::new(CALL),
            kind: NotificationKind::SummaryReady
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn a_call_whose_sections_all_failed_gets_the_failed_notice_unless_its_page_is_open() {
    let fail = r#"{"on": "post-call", "fail": "rate_limited"}"#;
    let r = open(&[fail; 14].join("\n"), true).await;
    seed_call(&r.core, CALL, 3);
    seed_call(&r.core, "call_shown", 3);
    let run = trigger(&r.core, JobKind::PostCall, CALL);
    assert_eq!(settle(&r.core, &run).await.status, JobRunStatus::Failed);
    // The main window shows the other call: its page shows the outcome, no notification.
    r.core.report_view(Some(CallId::new("call_shown")));
    let shown = trigger(&r.core, JobKind::PostCall, "call_shown");
    settle(&r.core, &shown).await;
    assert_eq!(
        *r.posted.0.lock().unwrap(),
        [Notification {
            call_id: CallId::new(CALL),
            kind: NotificationKind::SummaryFailed
        }]
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_archive_keeps_the_live_transcript_and_sends_the_users_names() {
    let r = open("", true).await;
    seed_call(&r.core, CALL, 3);
    let run = trigger(&r.core, JobKind::ArchivePass, CALL);
    settle(&r.core, &run).await;
    // The scripted engine's archive heard nothing: the live copy stays and the call says so.
    let call = rows(
        &r.core,
        &format!("SELECT archive_status FROM calls WHERE id = '{CALL}'"),
    );
    assert_eq!(call, vec![vec![json!("failed")]]);
    assert_eq!(
        rows(
            &r.core,
            "SELECT count(*) FROM segments WHERE pass = 'archive'"
        ),
        vec![vec![json!(0)]]
    );
    let constraints: Value = serde_json::from_slice(
        &std::fs::read(r.dir.path().join(format!("audio/{CALL}/constraints.json"))).unwrap(),
    )
    .unwrap();
    assert_eq!(
        constraints["speaker_names"],
        json!({"Anna Lee": "Anna Lee"})
    );
    assert_eq!(constraints["must_link"], json!([]));
    // No audio: failed without asking the engine.
    seed_call(&r.core, "call_mute", 1);
    r.core
        .store()
        .write(
            noter_db::Mutation {
                entity_type: "call",
                table: "calls",
                id: "call_mute".into(),
                base_rev: None,
                bump_rev: true,
                values: vec![("audio_deleted", json!(1))],
            },
            noter_db::ChangeMeta {
                actor: Actor::You,
                summary: "test".into(),
                reason: "test".into(),
                evidence_ids: vec![],
                batch_id: None,
                undoable: false,
                surface: None,
            },
        )
        .unwrap();
    let run = trigger(&r.core, JobKind::ArchivePass, "call_mute");
    settle(&r.core, &run).await;
    assert!(!r
        .dir
        .path()
        .join("audio/call_mute/constraints.json")
        .exists());
    assert_eq!(
        rows(
            &r.core,
            "SELECT archive_status FROM calls WHERE id = 'call_mute'"
        ),
        vec![vec![json!("failed")]]
    );
}

#[tokio::test(start_paused = true)]
async fn an_archive_of_a_silent_call_is_done_and_queues_the_regeneration() {
    let r = open("", true).await;
    seed_call(&r.core, CALL, 0);
    let run = trigger(&r.core, JobKind::ArchivePass, CALL);
    assert_eq!(settle(&r.core, &run).await.status, JobRunStatus::Succeeded);
    assert_eq!(
        rows(
            &r.core,
            &format!("SELECT archive_status FROM calls WHERE id = '{CALL}'")
        ),
        vec![vec![json!("done")]]
    );
    let queued = r
        .core
        .scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .filter(|row| row.kind == JobKind::Regeneration)
        .count();
    assert_eq!(queued, 1);
    // Done is done: a second pass does nothing.
    let again = trigger(&r.core, JobKind::ArchivePass, CALL);
    assert_eq!(
        settle(&r.core, &again).await.status,
        JobRunStatus::Succeeded
    );
}
