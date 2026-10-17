//! Performance page (stability: draft).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::HandoffTarget;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PerfPeriod {
    LastCall,
    Days7,
    Days30,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BudgetLevelState {
    Ok,
    Near,
    Over,
    NotEnoughData,
}

/// Headline tiles from PRD › Success metrics (PM-52): the UI sets no target of its own.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MetricTile {
    /// "hypothesis_lag", "answer_card", "confirmed_lag", "outputs_ready_cloud",
    /// "calls_without_dropouts", "cloud_requests_logged".
    pub metric: String,
    pub label: String,
    pub unit: String,
    pub p95: Option<f32>,
    pub target: f32,
    /// Release blocker metric.
    pub blocker: bool,
    pub state: BudgetLevelState,
    /// Last 20 calls, oldest first.
    pub trend: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct Bottleneck {
    /// "signals", "retrieval", "first_token", "full_card", "merge", "confirmed_text", ...
    pub stage: String,
    pub component: String,
    pub agent: Option<AgentRef>,
    pub over: u32,
    pub near: u32,
    pub example_calls: Vec<CallRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PerfOverviewArgs {
    pub period: PerfPeriod,
    #[serde(default)]
    pub call_type: Option<CallTypeId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct PerfOverview {
    pub tiles: Vec<MetricTile>,
    pub bottlenecks: Vec<Bottleneck>,
    pub calls_measured: u32,
    pub roll_up_failed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct StageTiming {
    pub stage: String,
    pub ms: DurationMs,
    pub budget_ms: DurationMs,
    pub state: BudgetLevelState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TickTiming {
    pub tick_id: TickId,
    /// The LLM run of this tick, when one ran.
    pub llm_run_id: Option<LlmRunId>,
    pub at_ms: OffsetMs,
    pub trigger: String,
    pub stages: Vec<StageTiming>,
    pub late: bool,
    pub dropped: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallPerf {
    pub call: CallRef,
    pub ticks: Vec<TickTiming>,
    /// Total length of dropouts (gaps with reason `interrupted`, `engine_restart`,
    /// `device_changed` or `stalled` longer than 2 s).
    pub dropout_ms: DurationMs,
    /// Cost of runs on API keys only; runs on the user's own account are not priced.
    pub cost_usd: f32,
    pub tokens_in: u32,
    pub tokens_out: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BriefAction {
    SaveFile,
    OpenIn { target: HandoffTarget },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BriefArgs {
    pub period: PerfPeriod,
    #[serde(default)]
    pub call_type: Option<CallTypeId>,
    pub action: BriefAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BriefResult {
    pub path: String,
    pub opened_with: Option<crate::model::LaunchPath>,
}
