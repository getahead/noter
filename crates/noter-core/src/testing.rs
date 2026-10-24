//! Hooks for `noter-core-harness` only (feature `harness`); the app never enables it.

use noter_protocol::model::{CapturePhase, CaptureState, ModelsStatus, SelfTestState};
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
