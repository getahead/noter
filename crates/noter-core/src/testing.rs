//! Hooks for `noter-core-harness` only (feature `harness`); the app never enables it.

use noter_protocol::model::{ModelsStatus, SelfTestState};

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
