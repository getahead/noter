//! Windows, navigation, hide for presenting, announcements and entity-change events.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::model::*;

/// Tauri window labels. Command scoping (PM-08) is per label.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum WindowLabel {
    Main,
    /// One window, two layouts (dedicated and floating).
    CallScreen,
    RecordPrompt,
    Settings,
    FirstRun,
}

impl WindowLabel {
    pub const fn as_str(self) -> &'static str {
        match self {
            WindowLabel::Main => "main",
            WindowLabel::CallScreen => "call-screen",
            WindowLabel::RecordPrompt => "record-prompt",
            WindowLabel::Settings => "settings",
            WindowLabel::FirstRun => "first-run",
        }
    }
    pub const ALL: [WindowLabel; 5] = [
        WindowLabel::Main,
        WindowLabel::CallScreen,
        WindowLabel::RecordPrompt,
        WindowLabel::Settings,
        WindowLabel::FirstRun,
    ];
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallLayout {
    Dedicated,
    Floating,
}

/// Event `window:call` and the result of call-window commands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallWindowState {
    pub version: StateVersion,
    pub visible: bool,
    pub key: bool,
    pub layout: CallLayout,
    pub collapsed: bool,
    pub display_id: Option<DisplayId>,
    /// The remembered call display is not connected.
    pub chosen_display_missing: bool,
    /// The share warning shows the first time the floating panel opens (PM-49).
    pub show_share_warning: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CallLayoutArgs {
    pub preference: CallLayoutPreference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CollapseArgs {
    pub collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HiddenArgs {
    pub hidden: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CallPageTab {
    Summary,
    Transcript,
    AgentReviews,
    History,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SettingsPane {
    General,
    AudioAndTranscription,
    ModelsAndRuntimes,
    Privacy,
    CallScreenAndMenuBar,
    Hotkeys,
    Repositories,
    KnowledgeSources,
    Maintenance,
    Performance,
    Updates,
}

/// A place in the main window or the Settings window. The core sends it with
/// `nav:request` (notification click, Open Last Summary, Open in Noter).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NavTarget {
    Today,
    CallPage {
        call_id: CallId,
        tab: CallPageTab,
        #[serde(default)]
        span: Option<TimeSpan>,
    },
    Item {
        item_id: ItemId,
    },
    Person {
        person_id: PersonId,
    },
    Topic {
        topic_id: TopicId,
    },
    Ask {
        #[serde(default)]
        thread_id: Option<AskThreadId>,
    },
    Activity,
    Agents {
        #[serde(default)]
        agent_id: Option<AgentId>,
    },
    Performance {
        #[serde(default)]
        call_id: Option<CallId>,
    },
    Settings {
        pane: SettingsPane,
    },
    FirstRun {
        #[serde(default)]
        step: Option<SetupStep>,
    },
    /// The **Delete Old Audio…** sheet over the main window's current page (D-17).
    DeleteOldAudio,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct NavigateArgs {
    #[serde(default)]
    pub target: Option<NavTarget>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Politeness {
    Polite,
    Assertive,
}

/// The core posts native announcements for panels that are not key (D55).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct AnnounceArgs {
    pub text: String,
    pub politeness: Politeness,
}

/// The record prompt's content size in points, measured by its webview: the panel fits it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct FitArgs {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ExternalTarget {
    /// http(s) only; opened in the default browser.
    Url {
        url: String,
    },
    Document {
        document_id: DocumentId,
        #[serde(default)]
        chunk_id: Option<ChunkId>,
    },
    SystemSettings {
        permission: PermissionKind,
    },
    RevealInFinder {
        path: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct OpenExternalArgs {
    pub target: ExternalTarget,
}

/// UI errors go to the app's local log through the core, never with transcript text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct UiLogArgs {
    pub level: UiLogLevel,
    pub screen: String,
    #[serde(default)]
    pub code: Option<crate::error::ErrorCode>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum UiLogLevel {
    Info,
    Warn,
    Error,
}

/// Event `entity:changed`: a record changed for any reason (a job, another
/// window, a model run). Windows that show it replace it by id.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EntityChanged {
    Call {
        call: CallRow,
    },
    Item {
        item: ItemView,
    },
    Person {
        person: PersonRow,
    },
    Topic {
        topic: TopicRow,
    },
    Agent {
        agent: AgentView,
    },
    Source {
        source: SourceRow,
    },
    Handoff {
        handoff: HandoffView,
    },
    Speakers {
        call_id: CallId,
        speakers: Vec<SpeakerView>,
    },
    /// An output section, whole: an edit, an undo or a regeneration that merged into it.
    Section {
        call_id: CallId,
        section: OutputSection,
    },
    Removed {
        kind: EntityKind,
        id: String,
    },
}
