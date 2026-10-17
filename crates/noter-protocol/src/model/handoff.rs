//! Handoff of an engineering action item to Claude Code or Codex.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{HandoffSummary, ItemView, RepoMapping, VersionMeta};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HandoffTarget {
    ClaudeCode,
    Codex,
}

/// The launch path the core will try first, as the drawer's launch-path line says it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LaunchPath {
    /// `claude-cli://open?cwd=…&q=…` (pre-filled, not sent).
    ClaudeCliLink,
    /// `claude://code/new`.
    ClaudeDesktop,
    /// `codex://new`.
    CodexApp,
    Terminal,
    Iterm,
    /// Nothing can launch; Copy Prompt only.
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LaunchPlan {
    pub path: LaunchPath,
    /// macOS will ask for Automation the first time (terminal fallback).
    pub needs_automation: bool,
    pub automation_denied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum HandoffAction {
    /// Default for the user's own items.
    Open,
    /// Default for anyone else's items (PM-48).
    CopyPrompt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PromptState {
    NotGenerated,
    Generating,
    Ready,
    Failed { code: crate::error::ErrorCode },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffView {
    pub item: ItemView,
    pub state: PromptState,
    pub rev: Option<Rev>,
    /// The prompt as it will be sent (the user's edit if there is one).
    pub prompt_md: Option<String>,
    /// The generated prompt, for the "edited" diff.
    pub generated_md: Option<String>,
    pub edited: bool,
    pub versions: Vec<VersionMeta>,
    pub target: HandoffTarget,
    pub repo: Option<RepoMapping>,
    /// The project key or component that has no mapping (prefills **Add Mapping…**).
    pub unmapped_key: Option<String>,
    pub launch: LaunchPlan,
    pub default_action: HandoffAction,
    pub last: Option<HandoffSummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffGenerateArgs {
    pub item_id: ItemId,
    /// Force a new version even if one is cached.
    pub regenerate: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffEditArgs {
    pub item_id: ItemId,
    pub rev: Rev,
    pub prompt_md: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffTargetArgs {
    pub item_id: ItemId,
    pub target: HandoffTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffOpenResult {
    pub path_used: LaunchPath,
    /// The item, now **handed off** (and accepted if it was suggested).
    pub item: ItemView,
    pub prompt_file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HandoffCopyResult {
    pub chars: u32,
    pub item: ItemView,
}
