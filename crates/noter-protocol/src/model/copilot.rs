//! Live copilot and role council (stability: draft — behind the copilot flag until M4).

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{ItemView, StreamEndReason};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardKind {
    Ask,
    Answer,
    Context,
    Pin,
    CatchUp,
    /// Carry-forward: "Did the handoff land?" or "Closed by evidence — object?".
    CarryForward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardState {
    /// First line arrived; provenance still streaming.
    Streaming,
    Shown,
    /// Hovered, focused or expanded: never removed while held.
    Held,
    Pinned,
    Dismissed,
    Expired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Rating {
    Up,
    Down,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CarryForward {
    HandoffLanded {
        item_id: ItemId,
    },
    EvidenceClosure {
        item_id: ItemId,
        evidence_id: EvidenceId,
    },
    OpenFromLastTime {
        item_id: ItemId,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardView {
    pub id: CardId,
    pub call_id: CallId,
    /// 1, 2 or 3 while visible; a visible card keeps its number (D71).
    pub number: Option<u8>,
    pub kind: CardKind,
    pub agent: AgentRef,
    /// Agents whose near-duplicate cards merged into this one, as text.
    pub merged_agents: Vec<AgentRef>,
    /// First line, rendered as soon as it streams (partial display).
    pub title: String,
    pub body: Option<String>,
    /// `null` while streaming; "Model guess · unverified" is `model_guess`.
    pub provenance: Option<Provenance>,
    pub state: CardState,
    /// Asked for (catch-up, Ask About This Call…) rather than unsolicited.
    pub solicited: bool,
    pub lang: Lang,
    pub created_at: TimestampMs,
    pub expires_at: Option<TimestampMs>,
    pub rating: Option<Rating>,
    pub carry_forward: Option<CarryForward>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CouncilMode {
    Fused,
    Parallel,
    Off,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum BudgetLevel {
    Ok,
    /// Above 90 % of the cap.
    Near,
    Paused,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct BudgetState {
    pub spent_usd: f32,
    pub cap_usd: f32,
    pub level: BudgetLevel,
    /// Runs on the user's own account count against the plan, not dollars.
    pub on_account: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MuteScope {
    ForMinutes {
        minutes: u16,
    },
    ThisCall,
    /// "For All Planning Calls", named after the current call type.
    CallType {
        call_type: CallTypeId,
    },
    /// Unmute.
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MuteState {
    pub scope: MuteScope,
    pub until: Option<TimestampMs>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentLiveState {
    pub agent: AgentRef,
    pub muted: bool,
    pub paused_reason: Option<crate::error::RuntimeUnavailableReason>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardKeysState {
    /// ⌃⌥⌘1–3 and ⌃⌥⌘Z are registered right now (only during capture with the copilot on and not hidden).
    pub registered: bool,
    /// Dismiss with keys (⌃⌥⌘⇧1–3) is on.
    pub dismiss_keys: bool,
    /// Keys another app took.
    pub conflicts: Vec<String>,
}

/// Copilot status for the call surfaces (`copilot:status` and inside the card stream).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CopilotStatus {
    pub call_id: Option<CallId>,
    pub flag_on: bool,
    pub single_agent: bool,
    pub mode: EffectiveMode,
    pub council: CouncilMode,
    pub muted: Option<MuteState>,
    pub budget: BudgetState,
    pub agents: Vec<AgentLiveState>,
    pub card_keys: CardKeysState,
    /// "Listening. Cards appear when there is something worth asking" until the first card.
    pub listening: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardsSubscribeArgs {
    pub call_id: CallId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardsSnapshot {
    pub subscription_id: Option<SubscriptionId>,
    pub call_id: CallId,
    /// At most three, in display order.
    pub visible: Vec<CardView>,
    /// The collapsed list of earlier cards with their outcome.
    pub earlier: Vec<CardView>,
    pub pinned: Vec<ItemView>,
    pub status: CopilotStatus,
    pub last_seq: Seq,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardMsg {
    pub seq: Seq,
    pub event: CardEvent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CardEvent {
    /// New card with its first line; slides in at the top.
    Added {
        card: CardView,
    },
    /// Body or provenance filled in, number or state changed: replace by id.
    Updated {
        card: CardView,
    },
    /// Remove from the visible stack (expired, dismissed, topic moved on); moves to `earlier`.
    Removed {
        card_id: CardId,
        state: CardState,
    },
    /// A card from another agent merged into this one.
    Merged {
        card_id: CardId,
        merged_agents: Vec<AgentRef>,
    },
    /// A card that would arrive after its 12 s window was dropped (metrics, "Card too late").
    DroppedLate {
        agent: AgentRef,
        trigger_at_ms: OffsetMs,
    },
    Status {
        status: CopilotStatus,
    },
    Ended {
        reason: StreamEndReason,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardArgs {
    pub card_id: CardId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardHeldArgs {
    pub card_id: CardId,
    /// Hovered, focused or expanded (wanted state).
    pub held: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardRateArgs {
    pub card_id: CardId,
    /// `null` clears the rating.
    pub rating: Option<Rating>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardShownArgs {
    pub card_id: CardId,
    /// When the card was actually painted; completes the latency measurement.
    pub shown_at: TimestampMs,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CardMutation {
    pub card: CardView,
    /// The item a pin created, if any.
    pub item: Option<ItemView>,
    pub change_id: Option<ChangeId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AskAboutCallArgs {
    pub call_id: CallId,
    pub question: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MuteArgs {
    pub call_id: Option<CallId>,
    pub scope: MuteScope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AgentMuteArgs {
    pub call_id: CallId,
    pub agent_id: AgentId,
    pub muted: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct RaiseBudgetArgs {
    pub call_id: CallId,
    pub cap_usd: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ContextChipAction {
    Pin,
    Unpin,
    Drop,
}

/// v1.x screen context chips.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ContextChipArgs {
    pub context_item_id: ContextItemId,
    pub action: ContextChipAction,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ContextChipView {
    pub id: ContextItemId,
    pub label: String,
    pub app: String,
    pub at: TimestampMs,
    pub pinned: bool,
    pub expires_at: Option<TimestampMs>,
}
