//! Maintenance jobs and their runs.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum JobKind {
    AppUpdate,
    ModelUpdate,
    IntegrityCheck,
    IndexRebuild,
    ReDerive,
    ReconcileTerms,
    ReconcilePeople,
    EvidenceCollection,
    SourceSync,
    MetricsRollUp,
    Backup,
    /// Post-call pipeline (offline pass, outputs) and regeneration.
    PostCall,
    ModelDownload,
    CliInstall,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum JobRunStatus {
    Queued,
    Running,
    Paused,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CountEntry {
    pub label: String,
    pub n: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobRunRow {
    pub id: JobRunId,
    pub job_id: JobId,
    pub kind: JobKind,
    pub name: String,
    pub started_at: TimestampMs,
    pub finished_at: Option<TimestampMs>,
    pub status: JobRunStatus,
    pub counts: Vec<CountEntry>,
    pub error: Option<crate::error::ErrorCode>,
    pub progress: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobRow {
    pub id: JobId,
    pub kind: JobKind,
    pub name: String,
    pub enabled: bool,
    /// "Startup, then daily", "Nightly", "After each call".
    pub trigger: String,
    pub allow_on_battery: bool,
    pub last_run: Option<JobRunRow>,
    pub running: bool,
    /// Jobs never run during a live call.
    pub blocked_by_call: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobList {
    pub jobs: Vec<JobRow>,
    pub evidence_tools: Vec<crate::model::CliInfo>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobIdArgs {
    pub job_id: JobId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobUpdateArgs {
    pub job_id: JobId,
    pub enabled: Option<bool>,
    pub allow_on_battery: Option<bool>,
}

/// Event `jobs:progress`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobProgress {
    pub run: JobRunRow,
}
