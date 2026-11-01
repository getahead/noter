//! FEATURE cpt-noter-feature-core-postcall, slice 1: the PostCall job writes the outputs from the
//! live transcript section by section through the router (the scripted runtime here), and the
//! outputs commands read, edit, compare and undo them. Paused tokio time throughout.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{Adapters, Clock, Core, CoreDeps, EventEmitter, Scripted};
use noter_db::Insert;
use noter_jobs::{CaptureGuardState, Request, Trigger};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi};
use noter_protocol::model::{
    CallIdArgs, CallOutputs, JobKind, JobRunStatus, OutputEditArgs, OutputMutation,
    OutputsProgress, OutputsStatus, RegenerateArgs, SectionKind, SectionState, SummaryIdArgs,
    UndoArgs, UndoTarget, VersionGetArgs, VersionKind, WindowLabel,
};
use noter_protocol::{
    CallId, CoreError, ErrorCode, ErrorDetail, JobRunId, Rev, RuntimeChoice, SummaryId, TimestampMs,
};
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
    fn all(&self) -> Vec<(&'static str, Value)> {
        self.0.lock().unwrap().clone()
    }

    fn progress(&self) -> Vec<OutputsProgress> {
        self.all()
            .into_iter()
            .filter(|(e, _)| *e == "outputs:progress")
            .map(|(_, p)| serde_json::from_value(p).unwrap())
            .collect()
    }
}

fn main_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

/// A core on a temp dir whose router answers from `script`, with the scheduler started.
async fn open(script: &str) -> (Arc<Core>, Arc<Events>, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let scripted = Scripted::parse(script).unwrap();
    let deps =
        CoreDeps::new(Arc::new(FixedClock), events.clone()).with_llm(Adapters::scripted(&scripted));
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();
    tokio::time::sleep(Duration::from_millis(10)).await;
    (core, events, dir)
}

fn ins(table: &'static str, values: Vec<(&'static str, Value)>) -> Insert {
    Insert { table, values }
}

/// A stopped planning call, still `processing`, with `segments` live segments.
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
                ("label", json!("spk_1")),
                ("n", json!(1)),
                ("channel", json!("sys")),
                ("pass", json!("live")),
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

fn post_call(core: &Core, id: &str) -> JobRunId {
    let req = Request::for_call(JobKind::PostCall, Trigger::AfterCall, &CallId::new(id));
    core.scheduler().trigger(req).unwrap().expect("queued")
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

fn run_status(core: &Core, id: &JobRunId) -> (JobRunStatus, Option<ErrorCode>) {
    let run = core
        .scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .find(|r| &r.id == id)
        .unwrap();
    (run.status, run.error)
}

fn call_status(core: &Core, id: &str) -> (String, String) {
    let id = id.to_owned();
    core.store()
        .read(move |c| {
            c.query_row(
                "SELECT status, outputs_status FROM calls WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
        })
        .unwrap()
}

fn count(core: &Core, table: &str) -> i64 {
    let sql = format!("SELECT count(*) FROM {table}");
    core.store()
        .read(move |c| c.query_row(&sql, [], |r| r.get(0)))
        .unwrap()
}

const ORDER: [SectionKind; 7] = [
    SectionKind::Summary,
    SectionKind::Decisions,
    SectionKind::ActionItems,
    SectionKind::OpenQuestions,
    SectionKind::PerParticipant,
    SectionKind::Risks,
    SectionKind::CallTypeExtras,
];

#[tokio::test(start_paused = true)]
async fn sections_land_in_order_within_two_minutes_and_the_call_is_ready_after_the_first() {
    // Every section answers after 10 s: seven sections in order are well inside two minutes.
    let line = r#"{"on": "post-call", "after_ms": 10000}"#;
    let script = [line; 7].join("\n");
    let (core, events, _dir) = open(&script).await;
    seed_call(&core, CALL, 3);
    let started = tokio::time::Instant::now();
    let run = post_call(&core, CALL);
    while run_status(&core, &run).0 != JobRunStatus::Succeeded {
        assert!(
            started.elapsed() < Duration::from_secs(120),
            "outputs within two minutes"
        );
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    let o = outputs(&core, CALL).await;
    let kinds: Vec<SectionKind> = o.sections.iter().map(|s| s.kind).collect();
    assert_eq!(kinds, ORDER);
    assert_eq!(o.status, OutputsStatus::Ready);
    assert_eq!(o.sections[0].state, SectionState::Ready);
    assert_eq!(o.sections[0].body_md.as_deref(), Some("Scripted summary."));
    let decisions = o.sections[1].body_md.as_deref().unwrap();
    assert!(decisions.contains("Scripted decision"), "{decisions}");
    assert_eq!(o.sections[2].state, SectionState::Ready);
    // A valid section with nothing in it is empty, not an error.
    for empty in &o.sections[3..] {
        assert_eq!(empty.state, SectionState::Empty, "{:?}", empty.kind);
    }
    let writer = o.sections[0].writer.clone().expect("provenance");
    assert_eq!(writer.skill, "planning");
    assert_eq!(writer.generated_at, TimestampMs(NOW));
    assert_ne!(writer.runtime, RuntimeChoice::Local);
    assert!(!o.written_locally);
    assert_eq!(o.sections[0].version_count, 1);
    assert_eq!(o.sections[0].rev, Some(Rev(1)));
    assert_eq!(call_status(&core, CALL), ("ready".into(), "ready".into()));
    // Progress: writing, then the committed state, section by section, in the stated order.
    let progress = events.progress();
    let steps: Vec<(SectionKind, SectionState)> = progress
        .iter()
        .map(|p| (p.section, p.state.clone()))
        .collect();
    let mut wanted = vec![];
    for (n, kind) in ORDER.iter().enumerate() {
        wanted.push((*kind, SectionState::Writing));
        let done = if n < 3 {
            SectionState::Ready
        } else {
            SectionState::Empty
        };
        wanted.push((*kind, done));
    }
    assert_eq!(steps, wanted);
    assert_eq!(progress.last().unwrap().status, OutputsStatus::Ready);
    // The call row is ready, and published, as soon as the first section committed.
    let all = events.all();
    let at = |ok: &dyn Fn(&str, &Value) -> bool| all.iter().position(|(e, p)| ok(e, p));
    let first_ready = at(&|e, p| e == "outputs:progress" && p["state"]["type"] == "ready");
    let call_ready = at(&|e, p| e == "entity:changed" && p["call"]["status"] == "ready");
    let decisions = at(&|e, p| e == "outputs:progress" && p["section"] == "decisions");
    assert!(
        first_ready < call_ready && call_ready < decisions,
        "{all:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_failed_section_keeps_the_earlier_ones_and_the_later_ones_still_run() {
    let script = [
        r#"{"on": "post-call"}"#,
        r#"{"on": "post-call", "fail": "rate_limited"}"#,
    ]
    .join("\n");
    let (core, _events, _dir) = open(&script).await;
    seed_call(&core, CALL, 3);
    let run = post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(30)).await;
    let o = outputs(&core, CALL).await;
    assert_eq!(o.sections[0].state, SectionState::Ready);
    assert_eq!(
        o.sections[1].state,
        SectionState::Failed {
            code: ErrorCode::RuntimeUnavailable,
            local_fallback_available: true,
        }
    );
    assert_eq!(o.sections[1].summary_id, None);
    assert_eq!(o.sections[2].state, SectionState::Ready);
    assert_eq!(o.status, OutputsStatus::PartiallyFailed);
    assert_eq!(
        call_status(&core, CALL),
        ("ready".into(), "partially_failed".into())
    );
    // The run ends with the typed failure of its failed section.
    assert_eq!(
        run_status(&core, &run),
        (JobRunStatus::Failed, Some(ErrorCode::RuntimeUnavailable))
    );
}

#[tokio::test(start_paused = true)]
async fn try_again_on_the_failed_section_makes_the_call_ready() {
    let script = [
        r#"{"on": "post-call"}"#,
        r#"{"on": "post-call", "fail": "rate_limited"}"#,
    ]
    .join("\n");
    let (core, _events, _dir) = open(&script).await;
    seed_call(&core, CALL, 3);
    post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(
        outputs(&core, CALL).await.status,
        OutputsStatus::PartiallyFailed
    );
    let again = core
        .outputs_regenerate(
            &main_window(),
            RegenerateArgs {
                call_id: CallId::new(CALL),
                sections: vec![SectionKind::Decisions],
                runtime: None,
                model: None,
                skill: None,
                local: false,
            },
        )
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(
        run_status(&core, &again.job_run_id),
        (JobRunStatus::Succeeded, None)
    );
    let o = outputs(&core, CALL).await;
    assert_eq!(o.sections[1].state, SectionState::Ready);
    assert_eq!(o.status, OutputsStatus::Ready);
    assert_eq!(call_status(&core, CALL), ("ready".into(), "ready".into()));
}

#[tokio::test(start_paused = true)]
async fn when_no_section_is_written_the_call_fails_with_the_typed_reason() {
    let fail = r#"{"on": "post-call", "fail": "rate_limited"}"#;
    let (core, events, _dir) = open(&[fail; 7].join("\n")).await;
    seed_call(&core, CALL, 3);
    let run = post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(call_status(&core, CALL), ("failed".into(), "failed".into()));
    assert_eq!(
        run_status(&core, &run),
        (JobRunStatus::Failed, Some(ErrorCode::RuntimeUnavailable))
    );
    let o = outputs(&core, CALL).await;
    assert_eq!(o.status, OutputsStatus::Failed);
    assert!(o
        .sections
        .iter()
        .all(|s| matches!(s.state, SectionState::Failed { .. })));
    let published = events
        .all()
        .into_iter()
        .any(|(e, p)| e == "entity:changed" && p["call"]["status"] == "failed");
    assert!(published, "the failed call row is published");
}

#[tokio::test(start_paused = true)]
async fn continue_recording_between_sections_writes_nothing_further() {
    let script = [
        r#"{"on": "post-call"}"#,
        r#"{"on": "post-call", "after_ms": 5000}"#,
    ]
    .join("\n");
    let (core, _events, _dir) = open(&script).await;
    seed_call(&core, CALL, 3);
    let run = post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(1)).await;
    // Continue Recording: the scheduler cancels the call's pipeline.
    core.capture_guard()
        .send(CaptureGuardState {
            live: true,
            resumed_call: Some(CallId::new(CALL)),
        })
        .unwrap();
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(run_status(&core, &run).0, JobRunStatus::Cancelled);
    assert_eq!(
        count(&core, "summaries"),
        1,
        "only the summary committed before the cancel"
    );
    let o = outputs(&core, CALL).await;
    assert_eq!(o.sections[0].state, SectionState::Ready);
    assert_eq!(o.sections[1].state, SectionState::Pending);
}

#[tokio::test(start_paused = true)]
async fn a_call_without_speech_has_empty_outputs_and_no_model_run() {
    let (core, _events, _dir) = open("").await;
    seed_call(&core, CALL, 0);
    let run = post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(run_status(&core, &run).0, JobRunStatus::Succeeded);
    let o = outputs(&core, CALL).await;
    assert!(o.sections.iter().all(|s| s.state == SectionState::Empty));
    assert_eq!(count(&core, "llm_runs"), 0);
    assert_eq!(call_status(&core, CALL), ("ready".into(), "ready".into()));
}

#[tokio::test(start_paused = true)]
async fn a_deleted_call_ends_its_post_call_run_quietly() {
    let (core, _events, _dir) = open("").await;
    let run = post_call(&core, "call_gone");
    tokio::time::sleep(Duration::from_secs(5)).await;
    assert_eq!(run_status(&core, &run).0, JobRunStatus::Succeeded);
    let missing = core
        .outputs_get(
            &main_window(),
            CallIdArgs {
                call_id: CallId::new("call_gone"),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
}

/// A ready call: the outputs the built-in scripted answers write.
async fn written() -> (Arc<Core>, Arc<Events>, tempfile::TempDir, CallOutputs) {
    let (core, events, dir) = open("").await;
    seed_call(&core, CALL, 3);
    post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(5)).await;
    let o = outputs(&core, CALL).await;
    assert_eq!(o.status, OutputsStatus::Ready);
    (core, events, dir, o)
}

async fn edit(
    core: &Core,
    call: &str,
    summary: &str,
    rev: u32,
    body: &str,
) -> Result<OutputMutation, CoreError> {
    core.output_edit(
        &main_window(),
        OutputEditArgs {
            call_id: CallId::new(call),
            summary_id: SummaryId::new(summary),
            rev: Rev(rev),
            body_md: body.into(),
        },
    )
    .await
}

#[tokio::test(start_paused = true)]
async fn an_edit_adds_a_version_and_every_version_stays_readable() {
    let (core, events, _dir, o) = written().await;
    let summary = o.sections[0].summary_id.clone().unwrap();
    let edited = edit(&core, CALL, summary.as_str(), 1, "My **own** summary.")
        .await
        .unwrap();
    assert_eq!(
        edited.section.body_md.as_deref(),
        Some("My **own** summary.")
    );
    assert!(edited.section.user_edited);
    assert_eq!(edited.section.rev, Some(Rev(2)));
    assert_eq!(edited.section.version_count, 2);
    assert_eq!(edited.section.state, SectionState::Ready);
    // The edited section is published.
    let last = events.progress().pop().unwrap();
    assert_eq!(
        (last.section, last.state),
        (SectionKind::Summary, SectionState::Ready)
    );
    // A stale revision is a conflict that names the current one.
    let stale = edit(&core, CALL, summary.as_str(), 1, "Late")
        .await
        .unwrap_err();
    assert_eq!(stale.code, ErrorCode::Conflict);
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    // Raw HTML, another call's section, an unknown section, an unknown call.
    let html = edit(&core, CALL, summary.as_str(), 2, "<b>no</b>")
        .await
        .unwrap_err();
    assert_eq!(html.code, ErrorCode::InvalidInput);
    seed_call(&core, "call_other", 1);
    let wrong = edit(&core, "call_other", summary.as_str(), 2, "x")
        .await
        .unwrap_err();
    assert_eq!(wrong.code, ErrorCode::InvalidInput);
    let unknown = edit(&core, CALL, "sum_nope", 1, "x").await.unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound);
    let no_call = edit(&core, "call_gone", summary.as_str(), 2, "x")
        .await
        .unwrap_err();
    assert_eq!(no_call.code, ErrorCode::NotFound);
    // Both versions, in order, each readable whole for the UI's diff.
    let list = core
        .output_versions(
            &main_window(),
            SummaryIdArgs {
                summary_id: summary.clone(),
            },
        )
        .await
        .unwrap();
    let ns: Vec<(u32, VersionKind)> = list.versions.iter().map(|v| (v.n, v.kind)).collect();
    assert_eq!(
        ns,
        [(1, VersionKind::Generated), (2, VersionKind::UserEdit)]
    );
    assert!(list.versions[0].writer.is_some());
    assert!(list.versions[1].writer.is_none());
    let first = core
        .output_version_get(
            &main_window(),
            VersionGetArgs {
                summary_id: summary.clone(),
                version_id: list.versions[0].id.clone(),
            },
        )
        .await
        .unwrap();
    assert_eq!(first.body_md, "Scripted summary.");
    assert_eq!(first.meta, list.versions[0]);
    let elsewhere = core
        .output_version_get(
            &main_window(),
            VersionGetArgs {
                summary_id: o.sections[1].summary_id.clone().unwrap(),
                version_id: list.versions[0].id.clone(),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(elsewhere.code, ErrorCode::NotFound);
    let none = core
        .output_versions(
            &main_window(),
            SummaryIdArgs {
                summary_id: SummaryId::new("sum_nope"),
            },
        )
        .await
        .unwrap_err();
    assert_eq!(none.code, ErrorCode::NotFound);
}

#[tokio::test(start_paused = true)]
async fn undoing_an_edit_brings_back_the_generated_version() {
    let (core, events, _dir, o) = written().await;
    let summary = o.sections[0].summary_id.clone().unwrap();
    let edited = edit(&core, CALL, summary.as_str(), 1, "Mine.")
        .await
        .unwrap();
    let before = events.progress().len();
    core.change_undo(
        &main_window(),
        UndoArgs {
            target: UndoTarget::Change {
                change_id: edited.change_id,
            },
        },
    )
    .await
    .unwrap();
    let back = outputs(&core, CALL).await;
    assert_eq!(
        back.sections[0].body_md.as_deref(),
        Some("Scripted summary.")
    );
    assert!(!back.sections[0].user_edited);
    // The edit stays readable as a version of its own, as every version does.
    assert_eq!(back.sections[0].version_count, 2);
    // The section is published again after the undo.
    let progress = events.progress();
    assert!(progress.len() > before);
    assert_eq!(progress.last().unwrap().section, SectionKind::Summary);
}

#[tokio::test(start_paused = true)]
async fn regenerate_queues_a_regeneration_run_and_refuses_during_capture() {
    let (core, _events, _dir, _o) = written().await;
    let args = |call: &str| RegenerateArgs {
        call_id: CallId::new(call),
        sections: vec![SectionKind::Summary],
        runtime: None,
        model: None,
        skill: None,
        local: false,
    };
    let accepted = core
        .outputs_regenerate(&main_window(), args(CALL))
        .await
        .unwrap();
    let run = core
        .scheduler()
        .runs()
        .unwrap()
        .into_iter()
        .find(|r| r.id == accepted.job_run_id)
        .expect("a queued run");
    assert_eq!(run.kind, JobKind::Regeneration);
    let missing = core
        .outputs_regenerate(&main_window(), args("call_gone"))
        .await
        .unwrap_err();
    assert_eq!(missing.code, ErrorCode::NotFound);
    core.capture_guard()
        .send(CaptureGuardState {
            live: true,
            resumed_call: None,
        })
        .unwrap();
    let blocked = core
        .outputs_regenerate(&main_window(), args(CALL))
        .await
        .unwrap_err();
    assert_eq!(blocked.code, ErrorCode::JobBlocked);
}

#[tokio::test(start_paused = true)]
async fn a_second_run_adds_versions_and_keeps_an_edit_made_while_the_model_ran() {
    let mut lines = vec![r#"{"on": "post-call"}"#; 7];
    lines.push(r#"{"on": "post-call", "after_ms": 5000}"#);
    let (core, _events, _dir) = open(&lines.join("\n")).await;
    seed_call(&core, CALL, 3);
    post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(5)).await;
    let summary = outputs(&core, CALL).await.sections[0]
        .summary_id
        .clone()
        .unwrap();
    // Continue Recording and a later stop queue a new generation; the summary is edited while
    // the model writes it.
    let run = post_call(&core, CALL);
    tokio::time::sleep(Duration::from_secs(1)).await;
    edit(&core, CALL, summary.as_str(), 1, "Mine.")
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(run_status(&core, &run).0, JobRunStatus::Succeeded);
    let again = outputs(&core, CALL).await;
    assert_eq!(again.sections[0].body_md.as_deref(), Some("Mine."));
    assert_eq!(again.sections[0].state, SectionState::Ready);
    assert_eq!(
        again.sections[0].version_count, 2,
        "the late generation is not kept over the edit"
    );
    assert_eq!(again.sections[1].version_count, 2);
    assert_eq!(again.sections[1].rev, Some(Rev(2)));
    assert_eq!(again.status, OutputsStatus::Ready);
}

#[tokio::test(start_paused = true)]
async fn regenerate_refuses_a_section_the_call_type_does_not_have() {
    let (core, _events, _dir) = open("").await;
    core.store()
        .insert_batch(vec![ins(
            "calls",
            vec![
                ("id", json!("call_1on1")),
                ("rev", json!(1)),
                ("started_at", json!(NOW - 3_600_000)),
                ("ended_at", json!(NOW - 60_000)),
                ("title", json!("1:1")),
                ("call_type", json!("one_on_one")),
                ("status", json!("ready")),
                ("mode_used", json!("cloud")),
            ],
        )])
        .unwrap();
    let args = |sections: Vec<SectionKind>| RegenerateArgs {
        call_id: CallId::new("call_1on1"),
        sections,
        runtime: None,
        model: None,
        skill: None,
        local: false,
    };
    let extras = core
        .outputs_regenerate(&main_window(), args(vec![SectionKind::CallTypeExtras]))
        .await
        .unwrap_err();
    assert_eq!(extras.code, ErrorCode::InvalidInput);
    // No sections means all of them.
    core.outputs_regenerate(&main_window(), args(vec![]))
        .await
        .unwrap();
}
