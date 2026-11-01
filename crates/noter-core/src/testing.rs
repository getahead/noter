//! Hooks for `noter-core-harness` only (feature `harness`); the app never enables it.

use noter_protocol::model::{
    CallDetection, CapturePhase, CaptureState, ModelsStatus, SelfTestState,
};
use noter_protocol::CoreError;

use crate::Core;

/// Seeds the self-test state as `harness.world_set` asks; the setup status, the system-audio
/// row and the detection rule follow it.
pub fn seed_self_test(core: &Core, state: SelfTestState) {
    core.seed_self_test(state);
}

/// Whether a system-audio re-check (D-19) is running.
pub fn system_audio_probing(core: &Core) -> bool {
    crate::lock(&core.first_run).probing
}

/// Seeds the bundle states and error as `harness.world_set` asks, after the files were placed
/// for the ready ones: `checksum_failed` and a download part-way live in the core, not in
/// `models/`. A running download keeps its own states.
pub fn seed_models(core: &Core, wanted: &ModelsStatus) {
    core.seed_models(wanted);
}

/// Seeds the capture state as `harness.world_set` asks; the call it names gets its `calls` row.
pub async fn seed_capture(core: &Core, state: CaptureState) -> Result<(), CoreError> {
    core.seed_capture(state).await
}

/// Hidden for presenting, as `harness.world_set` asks.
/// The detection as `harness.world_set` seeds it: the prompt shows for one, closes for none.
pub fn seed_detection(core: &Core, detection: Option<CallDetection>) {
    core.seed_detection(detection);
}

/// The system-audio state the world's environment row reports, `None` for not asked.
pub fn seed_system_audio(core: &Core, heard: Option<noter_protocol::PermissionState>) {
    core.seed_system_audio(heard);
}

/// Ends a call's live transcript stream with `reason`, as the hub does when a subscriber lags.
pub fn end_transcript_stream(
    core: &Core,
    call_id: &noter_protocol::CallId,
    reason: noter_protocol::model::StreamEndReason,
) {
    core.end_transcript_stream(call_id, reason);
}

pub fn seed_presenting(core: &Core, hidden: bool) {
    core.seed_presenting(hidden);
}

/// Starts the engine as the first command that needs it would.
pub async fn engine_ready(core: &Core) {
    let _ = core.engine.ensure_ready().await;
}

/// The session's event to its listeners, as capture sends it after a commit.
pub fn capture_event(core: &Core, event: crate::capture::CaptureEvent) {
    core.capture_event(event);
}

/// The next transcript commit "crashes" before it publishes (D-27: never in a release build).
pub fn fail_transcript_after_commit_once(core: &Core) {
    core.transcript.fail_after_commit_once();
}

/// The call the capture machine is recording or has paused, if any.
pub fn capturing(core: &Core) -> Option<noter_protocol::CallId> {
    let capture = core.capture_now();
    matches!(
        capture.phase,
        CapturePhase::Recording | CapturePhase::Paused
    )
    .then_some(capture.call_id)
    .flatten()
}

/// `harness.llm_run`: one `skill` run through the router and its egress gate on a packet of
/// `items` (`(id, text)`), cloud allowed; answers the validated output, its runtime and
/// `llm_runs` id, and the run's `audit_log` rows.
pub async fn llm_run(
    core: &Core,
    skill: &str,
    items: Vec<(String, String)>,
) -> Result<serde_json::Value, CoreError> {
    use noter_llm::{
        Failure, LlmRuntime, Packet, PacketItem, Privacy, RunRequest, Skill, SourceClass, TaskKind,
    };
    use noter_protocol::model::settings::AuditWhat;
    use noter_protocol::{ErrorCode, PrivacyMode};
    let skill = Skill::from_id(skill)
        .ok_or_else(|| CoreError::new(ErrorCode::InvalidInput, format!("no skill {skill:?}")))?;
    let items = items.into_iter().map(|(id, text)| PacketItem {
        id,
        source: SourceClass::Normal,
        text,
    });
    let packet = Packet {
        what: AuditWhat::FullTranscript,
        items: items.collect(),
        people: Vec::new(),
        context: Default::default(),
    };
    let (_privacy, rx) = tokio::sync::watch::channel(Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    });
    let req = RunRequest::new(skill, "harness", packet, TaskKind::PostCall, rx);
    let done = core.llm().run_once(req).await.map_err(|f| match f {
        Failure::Unavailable(e) | Failure::Storage(e) => e,
        other => CoreError::new(ErrorCode::Internal, format!("{other:?}")),
    })?;
    let run = done.provenance.llm_run_id.as_str().to_owned();
    let id = run.clone();
    let audit = core.store().read(move |c| {
        let mut stmt = c.prepare(
            "SELECT id, kind, what, destination, runtime_choice, llm_run_id, bytes_out \
             FROM audit_log WHERE llm_run_id = ?1 ORDER BY ts",
        )?;
        let rows = stmt.query_map([&id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "kind": r.get::<_, String>(1)?,
                "what": r.get::<_, String>(2)?,
                "destination": r.get::<_, String>(3)?,
                "runtime_choice": r.get::<_, String>(4)?,
                "llm_run_id": r.get::<_, String>(5)?,
                "bytes_out": r.get::<_, i64>(6)?,
            }))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })?;
    Ok(serde_json::json!({
        "output": done.output,
        "runtime": done.provenance.runtime,
        "llm_run_id": run,
        "audit": audit,
    }))
}
