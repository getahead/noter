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
    /// Post-call analysis of the live transcript (outputs, items). Runs during a later live
    /// call at low priority, after live ASR (D2).
    PostCall,
    /// The offline Large v3 pass that replaces the live transcript; waits for the call to end.
    ArchivePass,
    /// `outputs_regenerate` runs; wait for the call to end.
    Regeneration,
    /// Nightly: deletes audio past its retention date (logged, not undoable), live segments
    /// after 7 days and metrics after 365 days.
    Retention,
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
    /// Waits while a call is live: every job except post-call analysis (D2).
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
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub allow_on_battery: Option<bool>,
}

/// Event `jobs:progress`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct JobProgress {
    pub run: JobRunRow,
}
