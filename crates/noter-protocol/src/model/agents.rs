//! Agents of the role council and their skills (stability: draft).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::CouncilMode;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentStatus {
    Ok,
    /// Runtime unavailable; `fix` is the one-click switch the UI may offer (with Undo).
    Paused {
        reason: crate::error::RuntimeUnavailableReason,
        fix: Option<RuntimeChoice>,
    },
    /// Switched itself off in a call type after ten calls of dismissed cards.
    SwitchedOff {
        call_type: CallTypeId,
        after_calls: u16,
    },
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentStats {
    pub cards_7d: u32,
    /// 0..1 useful or used, over the last 7 days.
    pub useful_share: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentView {
    pub id: AgentId,
    pub rev: Rev,
    pub name: String,
    pub badge: String,
    pub builtin: bool,
    pub enabled: bool,
    pub order: u16,
    pub runtime: RuntimeChoice,
    pub model: String,
    pub effort: Effort,
    pub tools: Vec<String>,
    pub call_types: Vec<CallTypeId>,
    /// Percent of the per-call budget.
    pub budget_share: u8,
    pub status: AgentStatus,
    pub skill_path: String,
    pub stats: AgentStats,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CouncilModeRow {
    pub call_type: CallTypeId,
    pub live: CouncilMode,
    pub post_call: CouncilMode,
    pub agents: Vec<AgentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ModelOption {
    pub id: String,
    pub label: String,
    /// Fast class suggested for live use.
    pub live_ok: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RuntimeAvailability {
    pub runtime: RuntimeChoice,
    pub available: bool,
    pub reason: Option<crate::error::RuntimeUnavailableReason>,
    pub models: Vec<ModelOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentsView {
    pub agents: Vec<AgentView>,
    pub council: Vec<CouncilModeRow>,
    pub budget_total_pct: u16,
    pub runtimes: Vec<RuntimeAvailability>,
    /// Changes apply at the next tick, within a minute.
    pub live_call: Option<CallId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AgentTemplate {
    SecurityReviewer,
    Qa,
    Customer,
    Finance,
    Blank,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentCreateArgs {
    pub template: AgentTemplate,
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentIdArgs {
    pub agent_id: AgentId,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub runtime: Option<RuntimeChoice>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<Effort>,
    #[serde(default)]
    pub tools: Option<Vec<String>>,
    #[serde(default)]
    pub call_types: Option<Vec<CallTypeId>>,
    #[serde(default)]
    pub budget_share: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentUpdateArgs {
    pub agent_id: AgentId,
    pub rev: Rev,
    pub patch: AgentPatch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentMutation {
    pub agent: AgentView,
    pub change_id: ChangeId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentsReorderArgs {
    pub order: Vec<AgentId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentSkill {
    pub agent_id: AgentId,
    pub rev: Rev,
    pub body_md: String,
    pub is_default: bool,
    /// The skill file is missing on disk.
    pub missing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentSkillSaveArgs {
    pub agent_id: AgentId,
    pub rev: Rev,
    pub body_md: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CouncilModeArgs {
    pub call_type: CallTypeId,
    pub live: CouncilMode,
    pub post_call: CouncilMode,
}
