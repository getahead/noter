//! First run, models, permissions and the audio self-test.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{PermissionRow, StreamEndReason};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    Welcome,
    Models,
    Permissions,
    CallDisplay,
    AudioStorage,
    Assistants,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    Todo,
    Done,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct StepRow {
    pub step: SetupStep,
    pub state: StepState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BundleState {
    Pending,
    Downloading,
    Paused,
    Verifying,
    Ready,
    ChecksumFailed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ModelBundle {
    pub name: String,
    pub size_mb: u32,
    pub done_mb: u32,
    pub state: BundleState,
    /// Needed for the self-test and capture.
    pub required_for_capture: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ModelsStatus {
    pub bundles: Vec<ModelBundle>,
    pub total_mb: u32,
    pub done_mb: u32,
    pub error: Option<crate::error::ErrorCode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SelfTestState {
    NotRun,
    Running,
    Passed { at: TimestampMs },
    Failed { reason: SelfTestFailure },
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SelfTestFailure {
    OneStreamSilent {
        channel: AudioChannel,
    },
    /// System audio permission granted but buffers are zero (missing usage key, PRD).
    ZeroBuffers,
    OwnSoundsLeak,
    TimedOut,
    PermissionMissing {
        kind: PermissionKind,
    },
    ModelNotReady,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum StartControl {
    Record,
    /// While audio access or the self-test is missing (PM-30).
    FinishSetup,
}

/// `setup_status` and event `setup:changed`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SetupStatus {
    pub complete: bool,
    pub steps: Vec<StepRow>,
    pub models: ModelsStatus,
    pub permissions: Vec<PermissionRow>,
    pub self_test: SelfTestState,
    pub call_display: Option<DisplayId>,
    /// Call detection stays off until the self-test passes.
    pub detection_enabled: bool,
    pub start_control: StartControl,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum DownloadAction {
    Start,
    Pause,
    Resume,
    Retry,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ModelsDownloadArgs {
    pub action: DownloadAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PermissionArgs {
    pub kind: PermissionKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallDisplayArgs {
    pub display_id: Option<DisplayId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct StepArgs {
    pub step: SetupStep,
    pub state: StepState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AudioStorageArgs {
    pub never_store_audio: bool,
    pub retention: crate::model::AudioRetention,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SelfTestArgs {
    /// Play the short clip; any sound already playing in another app also counts.
    pub play_clip: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct SelfTestMsg {
    pub seq: Seq,
    pub event: SelfTestEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SelfTestEvent {
    Levels {
        mic_db: f32,
        sys_db: f32,
    },
    /// A live transcript line proving the pipeline end to end.
    Line {
        channel: AudioChannel,
        text: String,
    },
    StreamArrived {
        channel: AudioChannel,
    },
    Passed,
    Failed {
        reason: SelfTestFailure,
    },
    Ended {
        reason: StreamEndReason,
    },
}
