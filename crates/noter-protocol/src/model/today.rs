//! Today dashboard: one view-ready snapshot.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::{CallRow, ItemView, ProposalRow};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CalendarAccess {
    /// Show **Allow Calendar Access**; never asked automatically.
    NotAsked,
    Granted,
    Denied,
    ReadFailed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AttendeeChip {
    pub person: Option<PersonChip>,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct LastTimeLine {
    pub call: CallRef,
    /// The previous call's one-line summary.
    pub line: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UpcomingCall {
    pub event_id: CalendarEventId,
    pub title: String,
    pub starts_at: TimestampMs,
    pub ends_at: TimestampMs,
    pub platform: Option<String>,
    pub attendees: Vec<AttendeeChip>,
    /// Marked sensitive in advance.
    pub sensitive: bool,
    /// The recording made during this event, once there is one.
    pub call_id: Option<CallId>,
    pub last_time: Option<LastTimeLine>,
    /// Items you own first, then items you wait on; ranked by the core.
    pub items: Vec<ItemView>,
    pub questions: Vec<ItemView>,
    pub handed_off: Vec<ItemView>,
    pub open_count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TodayBanner {
    SelfTestNotPassed,
    RecordingInterruptedByQuit { call: CallRef },
    AudioAccessNeverGranted,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct TodayView {
    pub date: LocalDate,
    pub calendar: CalendarAccess,
    pub live_call: Option<CallRow>,
    pub today: Vec<UpcomingCall>,
    pub this_week: Vec<UpcomingCall>,
    pub due_without_call: Vec<ItemView>,
    pub done_today: Vec<ItemView>,
    /// Suggested items not reviewed yet (the review line).
    pub review_waiting: u32,
    pub proposals: Vec<ProposalRow>,
    pub proposals_total: u32,
    pub banners: Vec<TodayBanner>,
    pub first_use: bool,
}
