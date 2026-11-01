//! The UI ↔ core IPC contract (`cpt-noter-interface-core-ipc`).
//!
//! Three transports, one rule each (DESIGN 3.3, ADR-0002):
//! * **Commands** (request → response): the user's intent. Every command takes
//!   one `args` object and returns one record or a [`CoreError`]. Commands that
//!   set state send the wanted state, never a toggle.
//! * **Channels** (ordered streams): a command that subscribes returns a
//!   snapshot up to `last_seq`, and the Channel delivers strictly after it.
//! * **Events** (low rate, broadcast to every window): app-level state, sent
//!   whole so a missed event never leaves a stale view.
//!
//! The registry below is the single list. From it this crate generates:
//! the [`CoreApi`] trait the core implements, the [`COMMANDS`]/[`EVENTS`]
//! manifests the window-scope guard and the contract tests read, and (through
//! `bin/export.rs`) the TypeScript client and the fake-core handler interface.

use std::future::Future;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::{Type, Types};

use crate::common::*;
use crate::error::{CoreError, ErrorCode};
use crate::model::*;

/// Whether the UI may build on a surface as final.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum Stability {
    /// The UI may build on it as final. It changes only additively in a minor contract
    /// version (a new command, event, optional field or enum variant); anything else needs a
    /// major version that both the core and the UI team sign off.
    Frozen,
    /// Shape may change in a minor version until the feature's milestone gate (copilot, council, performance, v1.x).
    Draft,
}

/// Operation groups, matching DESIGN 3.3 (UI) one to one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CommandGroup {
    App,
    CaptureControl,
    Transcript,
    Copilot,
    Items,
    Today,
    OutputsAndSharing,
    Handoff,
    LibraryAndAsk,
    HistoryAndUndo,
    People,
    Agents,
    SettingsAndCredentials,
    Performance,
    FirstRunAndPermissions,
    Windows,
}

/// One command of the contract, as data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandSpec {
    /// Tauri command name (`snake_case`), also the `invoke` name.
    pub name: &'static str,
    pub args: &'static str,
    pub result: &'static str,
    /// Message type of the Channel, for subscribing commands.
    pub channel: Option<&'static str>,
    pub group: CommandGroup,
    pub stability: Stability,
    /// Windows allowed to call it (PM-08). Enforced by the core and the fake.
    pub windows: &'static [WindowLabel],
    pub doc: &'static str,
}

impl CommandSpec {
    pub fn allows(&self, w: WindowLabel) -> bool {
        self.windows.contains(&w)
    }

    /// The window-scope check the IPC host runs before any handler: a window must be listed
    /// (`window_not_allowed` otherwise); a native surface of the core skips it.
    pub fn check_caller(&self, caller: &Caller) -> Result<(), CoreError> {
        match caller {
            Caller::Window { label } if !self.allows(*label) => Err(CoreError::new(
                ErrorCode::WindowNotAllowed,
                format!("{} from {}", self.name, label.as_str()),
            )),
            _ => Ok(()),
        }
    }
}

/// One event of the contract, as data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EventSpec {
    /// Tauri event name, `area:what`.
    pub name: &'static str,
    pub payload: &'static str,
    pub stability: Stability,
    pub doc: &'static str,
}

/// Context the IPC host passes to every handler.
#[derive(Debug, Clone)]
pub struct CommandCtx {
    pub caller: Caller,
}

/// Who sent a command.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Caller {
    /// A webview window; its label was already checked against the command's scope.
    Window { label: WindowLabel },
    /// A native surface of the core itself. Skips the scope check; the change log records
    /// the surface as the actor's surface.
    Native { surface: NativeSurface },
}

/// Native surfaces that call core commands directly, without a webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum NativeSurface {
    /// The app menu.
    Menu,
    /// The menu bar extra and its menu.
    MenuBar,
    /// A global hotkey.
    Hotkey,
    /// A click on a notification or one of its actions.
    Notification,
}

/// The sending half of a Channel, abstracted so the core logic does not depend
/// on Tauri. `send` returns `false` when the receiver is gone (window closed);
/// the core then drops the subscription.
#[derive(Clone)]
pub struct Sink<T>(Arc<dyn Fn(T) -> bool + Send + Sync>);

impl<T> Sink<T> {
    pub fn new(f: impl Fn(T) -> bool + Send + Sync + 'static) -> Self {
        Self(Arc::new(f))
    }
    pub fn send(&self, msg: T) -> bool {
        (self.0)(msg)
    }
}

impl<T> std::fmt::Debug for Sink<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Sink")
    }
}

/// Arguments for [`dispatch_json`]. serde's message can quote the input, which may hold transcript
/// text, so the error names only the command and the type.
fn parse_args<T: serde::de::DeserializeOwned>(
    name: &str,
    ty: &str,
    args: serde_json::Value,
) -> Result<T, CoreError> {
    serde_json::from_value(args).map_err(|_| {
        CoreError::new(
            ErrorCode::InvalidInput,
            format!("{name}: arguments do not parse as {ty}"),
        )
    })
}

/// The typed Channel of a subscribing command over the transport's JSON sink.
fn typed_sink<T: Serialize + 'static>(
    name: &str,
    channel: Option<Sink<serde_json::Value>>,
) -> Result<Sink<T>, CoreError> {
    let out = channel.ok_or_else(|| {
        CoreError::new(
            ErrorCode::InvalidInput,
            format!("{name}: a subscribing command needs a Channel"),
        )
    })?;
    Ok(Sink::new(move |m: T| {
        serde_json::to_value(m).is_ok_and(|v| out.send(v))
    }))
}

fn to_json<T: Serialize>(v: T) -> Result<serde_json::Value, CoreError> {
    serde_json::to_value(v).map_err(|e| CoreError::new(ErrorCode::Internal, e.to_string()))
}

macro_rules! window_list {
    ($($w:ident)|+) => { &[$(WindowLabel::$w),+] };
}

macro_rules! commands {
    ($(
        $(#[doc = $doc:literal])*
        $name:ident ( $args:ty $(, channel: $chan:ty)? ) -> $ret:ty
            [$group:ident, $stab:ident, $($w:ident)|+];
    )*) => {
        /// Every command of the contract, in group order.
        pub const COMMANDS: &[CommandSpec] = &[$(
            CommandSpec {
                name: stringify!($name),
                args: stringify!($args),
                result: stringify!($ret),
                channel: commands!(@chan $($chan)?),
                group: CommandGroup::$group,
                stability: Stability::$stab,
                windows: window_list!($($w)|+),
                doc: concat!($($doc, "\n",)* ""),
            },
        )*];

        // @cpt-dod:cpt-noter-dod-core-contract-coreapi:p1
        /// The core implements this trait on its composition root. The IPC host and
        /// `noter-core-harness` reach it through [`dispatch_json`] (or call a method after
        /// [`CommandSpec::check_caller`]). Every method answers `not_implemented` until the core
        /// implements it, so an early core answers what its milestone delivers and the
        /// conformance suite lists the rest as pending. DESIGN-core 3.3 keeps `not_implemented` to
        /// development builds; a release build relies on the conformance suite judging it by
        /// milestone: a command of the current milestone that still answers it fails the run.
        pub trait CoreApi: Send + Sync + 'static {
            $(
                $(#[doc = $doc])*
                fn $name(&self, _ctx: &CommandCtx, _args: $args $(, _channel: Sink<$chan>)?)
                    -> impl Future<Output = Result<$ret, CoreError>> + Send {
                    std::future::ready(Err(CoreError::new(ErrorCode::NotImplemented, stringify!($name))))
                }
            )*
        }

        /// Runs one command by name with JSON arguments, as the IPC host and
        /// `noter-core-harness` receive it: the window-scope check, then the Channel and the
        /// arguments (`invalid_input` naming the command, never echoing the input), then the
        /// [`CoreApi`] method; the result and every Channel message cross as JSON.
        /// An unknown name is `invalid_input`.
        pub async fn dispatch_json<A: CoreApi>(
            api: &A,
            ctx: &CommandCtx,
            name: &str,
            args: serde_json::Value,
            channel: Option<Sink<serde_json::Value>>,
        ) -> Result<serde_json::Value, CoreError> {
            if let Some(spec) = command(name) {
                spec.check_caller(&ctx.caller)?;
            }
            match name {
                $(stringify!($name) => {
                    $( let channel = typed_sink::<$chan>(stringify!($name), channel)?; )?
                    let args = parse_args::<$args>(stringify!($name), stringify!($args), args)?;
                    to_json(api.$name(ctx, args $(, commands!(@channel channel $chan))?).await?)
                })*
                _ => Err(CoreError::new(ErrorCode::InvalidInput, format!("no command {name}"))),
            }
        }

        /// Registers every argument type (and what it contains), for the contract tests.
        pub fn register_arg_types(types: Types) -> Types {
            types $( .register::<$args>() )*
        }

        /// Registers every argument, result and Channel message type for export.
        pub fn register_command_types(types: Types) -> Types {
            types
            $(
                .register::<$args>()
                .register::<$ret>()
                $(.register::<$chan>())?
            )*
        }
    };
    (@chan $chan:ty) => { Some(stringify!($chan)) };
    (@chan) => { None };
    (@channel $sink:ident $chan:ty) => { $sink };
}

macro_rules! events {
    ($(
        $(#[doc = $doc:literal])*
        $konst:ident = $name:literal => $payload:ty [$stab:ident];
    )*) => {
        /// Event names as constants for the core's emitters.
        pub mod event_names {
            $( pub const $konst: &str = $name; )*
        }

        /// Every event of the contract.
        pub const EVENTS: &[EventSpec] = &[$(
            EventSpec {
                name: $name,
                payload: stringify!($payload),
                stability: Stability::$stab,
                doc: concat!($($doc, "\n",)* ""),
            },
        )*];

        pub fn register_event_types(types: Types) -> Types {
            types $( .register::<$payload>() )*
        }
    };
}

// The command registry: the single list of the IPC interface.
// @cpt-interface:cpt-noter-interface-core-ipc:p1
// Windows: Main, CallScreen, RecordPrompt, Settings, FirstRun.
commands! {
    // ── App ───────────────────────────────────────────────────────────────
    /// Everything app-level a window renders from. Called on open, reload and after a crash.
    app_snapshot(NoArgs) -> AppSnapshot [App, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    /// Ends any Channel subscription (transcript, cards, levels, ask, self-test).
    stream_unsubscribe(UnsubscribeArgs) -> Ack [App, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    /// Acknowledges a Channel up to `seq`, every 100 messages or 1 s (the generated client does it).
    /// At 2 000 unacknowledged messages the core ends the subscription with `lagged`.
    stream_ack(StreamAckArgs) -> Ack [App, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    /// UI errors to the local log, never with transcript text.
    log_ui(UiLogArgs) -> Ack [App, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    /// Dismiss an app banner (for example "Noter quit during a recording").
    banner_dismiss(BannerDismissArgs) -> BannerSet [App, Frozen, Main];

    // ── Capture control ───────────────────────────────────────────────────
    /// Start capture (Record, Record as Sensitive, hotkey, menu, Today). Never gated on setup or
    /// permissions; refused only with `already_recording`, `disk_full` or `model_missing`.
    /// Allowed while `stopped`: closes the stopped call's Continue window.
    capture_start(CaptureStartArgs) -> CaptureState [CaptureControl, Frozen, RecordPrompt | CallScreen | Main];
    /// Stop now. The call window shows its closing state; Continue Recording is offered for 5 minutes.
    capture_stop(CallIdArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | Main];
    /// Pause or resume (wanted state). Pause drops audio entirely. Resume of a stopped call is
    /// refused with `not_recording` (use `capture_continue`).
    capture_set_paused(CapturePauseArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | Main];
    /// Mark a moment.
    capture_mark_moment(MarkMomentArgs) -> MarkView [CaptureControl, Frozen, CallScreen];
    /// Answer the call-ended notice: Keep Recording or Stop Now.
    capture_answer_call_end(CallEndAnswerArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | RecordPrompt];
    /// Hold the call-ended countdown while the pointer or focus is on the notice (wanted state);
    /// on release the 10-second countdown starts again.
    capture_hold_notice(NoticeHoldArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | RecordPrompt];
    /// Continue Recording after any stop, within 5 minutes; appends with a gap row. Cancels the
    /// queued or running post-call job and queues it again after the next stop (edits are kept).
    capture_continue(CallIdArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | RecordPrompt | Main];
    /// Resume Recording after Noter quit or crashed mid-call (gap row `interrupted`, allowed while
    /// the `recording_interrupted_by_quit` banner is shown), or **Try Again** after the engine
    /// stopped (phase `failed`; gap row `engine_restart`). Continues the same call.
    capture_resume_interrupted(CallIdArgs) -> CaptureState [CaptureControl, Frozen, Main | CallScreen];
    /// Answer the new-meeting notice: Start as New Call (default) or Keep in This Call.
    capture_answer_new_meeting(NewMeetingAnswerArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | RecordPrompt];
    /// Keep Recording on the nothing-heard notice; resets the 5-minute timer.
    capture_keep_recording(CallIdArgs) -> CaptureState [CaptureControl, Frozen, CallScreen];
    /// Discard Recording (nothing heard), after the inline confirmation.
    capture_discard(CallIdArgs) -> CaptureState [CaptureControl, Frozen, CallScreen];
    /// Make This Call Sensitive (during capture), or change it from Call info afterwards.
    capture_set_sensitive(SensitiveArgs) -> CaptureState [CaptureControl, Frozen, CallScreen | Main];
    /// Exclude a second audio source from the tap.
    capture_exclude_source(ExcludeSourceArgs) -> CaptureState [CaptureControl, Frozen, CallScreen];
    /// Keep a second audio source in the tap; its banner is not shown again for that app in this call.
    capture_keep_source(KeepSourceArgs) -> CaptureState [CaptureControl, Frozen, CallScreen];
    /// Not Now, × or timed out on the record prompt.
    capture_dismiss_detection(DismissDetectionArgs) -> Ack [CaptureControl, Frozen, RecordPrompt];
    /// Don't Ask for <app>… from the prompt's pull-down.
    capture_ignore_app(IgnoreAppArgs) -> Ack [CaptureControl, Frozen, RecordPrompt];

    // ── Transcript ────────────────────────────────────────────────────────
    /// Snapshot of a call's transcript, then the live stream for a live call.
    transcript_subscribe(TranscriptSubscribeArgs, channel: TranscriptMsg) -> TranscriptSnapshot [Transcript, Frozen, CallScreen | Main];
    /// Microphone and system levels, at most every 100 ms.
    levels_subscribe(SubscribeLevelsArgs, channel: LevelsMsg) -> SubscriptionHandle [Transcript, Frozen, CallScreen | Main | Settings | FirstRun];
    /// Rename a speaker for the whole call or one line.
    transcript_rename_speaker(RenameSpeakerArgs) -> SpeakerMutation [Transcript, Frozen, CallScreen | Main];
    /// Fix a term; optionally add it to the glossary.
    transcript_fix_term(FixTermArgs) -> FixTermResult [Transcript, Frozen, CallScreen | Main];
    /// Name the speakers after the call (speaker naming panel), skip allowed.
    transcript_name_speakers(NameSpeakersArgs) -> SpeakerMutation [Transcript, Frozen, Main];
    /// Segments of an evidence span, for the popover and the span preview.
    transcript_span(SpanArgs) -> SpanPreview [Transcript, Frozen, CallScreen | Main];
    /// Play audio natively: the engine plays it (D6; no media in the WebView). During capture,
    /// headphones only.
    audio_play(PlayAudioArgs) -> PlaybackState [Transcript, Frozen, CallScreen | Main];
    audio_stop(NoArgs) -> PlaybackState [Transcript, Frozen, CallScreen | Main];
    /// Delete the audio of calls (irreversible; native alert first).
    audio_delete(DeleteAudioArgs) -> DeleteAudioResult [Transcript, Frozen, Main];
    /// Delete Old Audio… sheet.
    audio_delete_older(DeleteOldAudioArgs) -> DeleteAudioResult [Transcript, Frozen, Main];

    // ── Copilot (draft until the M4 latency gate) ─────────────────────────
    /// Visible and earlier cards, pinned items and status, then the card stream.
    cards_subscribe(CardsSubscribeArgs, channel: CardMsg) -> CardsSnapshot [Copilot, Draft, CallScreen];
    card_pin(CardArgs) -> CardMutation [Copilot, Draft, CallScreen];
    card_dismiss(CardArgs) -> CardMutation [Copilot, Draft, CallScreen];
    /// Unpin a pinned card; the item the pin created is removed.
    card_unpin(CardArgs) -> CardMutation [Copilot, Draft, CallScreen];
    /// Undo the last card action (⌃⌥⌘Z equivalent from the panel), within 30 s; then `undo_expired`.
    card_undo_last(CallIdArgs) -> CardMutation [Copilot, Draft, CallScreen];
    /// Hovered, focused or expanded: the core never expires a held card.
    card_set_held(CardHeldArgs) -> Ack [Copilot, Draft, CallScreen];
    card_rate(CardRateArgs) -> CardMutation [Copilot, Draft, CallScreen | Main];
    /// The UI reports when a card was painted (completes the latency measurement).
    card_shown(CardShownArgs) -> Ack [Copilot, Draft, CallScreen];
    /// Catch Me Up: a solicited catch-up card arrives on the card stream.
    copilot_catch_up(CallIdArgs) -> Ack [Copilot, Draft, CallScreen];
    /// Ask About This Call…: the answer arrives as a solicited card.
    copilot_ask_about_call(AskAboutCallArgs) -> Ack [Copilot, Draft, CallScreen];
    copilot_mute(MuteArgs) -> CopilotStatus [Copilot, Draft, CallScreen | Main];
    copilot_mute_agent(AgentMuteArgs) -> CopilotStatus [Copilot, Draft, CallScreen];
    copilot_raise_budget(RaiseBudgetArgs) -> CopilotStatus [Copilot, Draft, CallScreen];
    /// v1.x screen context chips: returns `feature_disabled` in v1.
    context_chip_set(ContextChipArgs) -> ContextChipView [Copilot, Draft, CallScreen];

    // ── Items ─────────────────────────────────────────────────────────────
    items_list(ItemsListArgs) -> Page<ItemView> [Items, Frozen, Main];
    /// Item inspector.
    item_get(ItemIdArgs) -> ItemDetail [Items, Frozen, Main | CallScreen];
    /// Tick or untick (wanted state). A tick on a suggested item accepts it.
    item_set_done(ItemDoneArgs) -> ItemMutation [Items, Frozen, Main | CallScreen];
    item_review(ItemReviewArgs) -> ItemMutation [Items, Frozen, Main];
    items_review_all(ReviewAllArgs) -> ItemsBatchResult [Items, Frozen, Main];
    item_edit(ItemEditArgs) -> ItemMutation [Items, Frozen, Main | CallScreen];
    item_reopen(ItemReopenArgs) -> ItemMutation [Items, Frozen, Main | CallScreen];
    item_create(ItemCreateArgs) -> ItemMutation [Items, Frozen, Main | CallScreen];
    /// Answer the carry-forward "Did the handoff land?": Yes, Landed, Done Another Way or Keep Open.
    item_answer_handoff_landed(HandoffLandedArgs) -> ItemMutation [Items, Frozen, Main | CallScreen];

    // ── Today ─────────────────────────────────────────────────────────────
    today_get(NoArgs) -> TodayView [Today, Frozen, Main];

    // ── Outputs and sharing ───────────────────────────────────────────────
    outputs_get(CallIdArgs) -> CallOutputs [OutputsAndSharing, Frozen, Main];
    output_edit(OutputEditArgs) -> OutputMutation [OutputsAndSharing, Frozen, Main];
    /// Regenerate sections with another runtime, model or skill; edits are kept and diffed.
    outputs_regenerate(RegenerateArgs) -> JobAccepted [OutputsAndSharing, Frozen, Main];
    output_versions(SummaryIdArgs) -> VersionList [OutputsAndSharing, Frozen, Main];
    output_version_get(VersionGetArgs) -> VersionBody [OutputsAndSharing, Frozen, Main];
    /// Copy for Slack, Copy for Jira, Copy as Markdown (the core writes the clipboard, rich and plain).
    share_copy(ShareCopyArgs) -> ShareResult [OutputsAndSharing, Frozen, Main];
    /// Export… a folder of Markdown, SRT, JSON and audio, for whole calls or a section or selection;
    /// the core shows the save panel.
    calls_export(ExportCallsArgs) -> ExportResult [OutputsAndSharing, Frozen, Main];

    // ── Handoff ───────────────────────────────────────────────────────────
    handoff_get(ItemIdArgs) -> HandoffView [Handoff, Frozen, Main];
    /// Generate on demand (cached); `regenerate` forces a new version. Returns at once with state
    /// `generating`; the result arrives through `entity:changed`.
    handoff_generate(HandoffGenerateArgs) -> HandoffView [Handoff, Frozen, Main];
    /// Stop a prompt that is generating.
    handoff_cancel(ItemIdArgs) -> HandoffView [Handoff, Frozen, Main];
    handoff_edit(HandoffEditArgs) -> HandoffView [Handoff, Frozen, Main];
    handoff_set_target(HandoffTargetArgs) -> HandoffView [Handoff, Frozen, Main];
    /// Open in Claude Code or Codex through the launch path the drawer showed. Accepts a suggested
    /// item; records the prompt version and whether it was edited.
    handoff_open(ItemIdArgs) -> HandoffOpenResult [Handoff, Frozen, Main];
    /// Copy Prompt. Accepts a suggested item; records the prompt version and whether it was edited.
    handoff_copy(ItemIdArgs) -> HandoffCopyResult [Handoff, Frozen, Main];

    // ── Library and Ask ───────────────────────────────────────────────────
    calls_list(CallsListArgs) -> Page<CallRow> [LibraryAndAsk, Frozen, Main];
    call_get(CallIdArgs) -> CallDetail [LibraryAndAsk, Frozen, Main | CallScreen];
    call_update(CallUpdateArgs) -> CallMutation [LibraryAndAsk, Frozen, Main];
    call_tags_set(TagsSetArgs) -> TagsSetResult [LibraryAndAsk, Frozen, Main];
    tags_list(NoArgs) -> TagList [LibraryAndAsk, Frozen, Main];
    /// Delete calls for good (native alert first).
    calls_delete(CallsDeleteArgs) -> DeleteResult [LibraryAndAsk, Frozen, Main];
    call_types_list(NoArgs) -> CallTypeList [LibraryAndAsk, Frozen, Main | CallScreen | Settings];
    /// Hybrid search, sectioned, each hit strong or weak.
    search(SearchArgs) -> SearchResults [LibraryAndAsk, Frozen, Main];
    /// Ask with a scope; the answer streams with citations.
    ask_start(AskStartArgs, channel: AskMsg) -> AskHandle [LibraryAndAsk, Frozen, Main];
    ask_stop(AskTurnArgs) -> Ack [LibraryAndAsk, Frozen, Main];
    ask_threads_list(NoArgs) -> AskThreadList [LibraryAndAsk, Frozen, Main];
    ask_thread_get(AskThreadArgs) -> AskThread [LibraryAndAsk, Frozen, Main];
    ask_thread_delete(AskThreadArgs) -> Ack [LibraryAndAsk, Frozen, Main];
    ask_scope_presets(NoArgs) -> ScopePresetList [LibraryAndAsk, Frozen, Main];
    topics_list(NoArgs) -> TopicList [LibraryAndAsk, Frozen, Main];
    topic_get(TopicIdArgs) -> TopicThread [LibraryAndAsk, Frozen, Main];
    topic_rename(TopicRenameArgs) -> TopicMutation [LibraryAndAsk, Frozen, Main];
    topics_merge(TopicMergeArgs) -> TopicMutation [LibraryAndAsk, Frozen, Main];
    /// Keep Separate: never suggest this merge again.
    topics_keep_separate(TopicPairArgs) -> Ack [LibraryAndAsk, Frozen, Main];

    // ── History and undo ──────────────────────────────────────────────────
    history_list(HistoryListArgs) -> Page<ChangeRow> [HistoryAndUndo, Frozen, Main];
    /// Undo a change or a batch. Never expires; rows edited later are kept and counted.
    change_undo(UndoArgs) -> UndoResult [HistoryAndUndo, Frozen, Main | CallScreen];
    /// Redo an undone change or batch, at any time while its rows were not edited later.
    change_redo(RedoArgs) -> UndoResult [HistoryAndUndo, Frozen, Main | CallScreen];
    proposals_list(ProposalsListArgs) -> Page<ProposalRow> [HistoryAndUndo, Frozen, Main];
    proposal_decide(ProposalDecideArgs) -> ProposalOutcome [HistoryAndUndo, Frozen, Main];
    proposal_always_for_term(AlwaysForTermArgs) -> GlossaryTerm [HistoryAndUndo, Frozen, Main];
    /// Export Log… for one call or a period (Markdown or JSON); the core shows the save panel.
    history_export(HistoryExportArgs) -> ExportResult [HistoryAndUndo, Frozen, Main];
    activity_get(ActivityArgs) -> ActivityView [HistoryAndUndo, Frozen, Main];

    // ── People ────────────────────────────────────────────────────────────
    people_list(PeopleListArgs) -> PeopleList [People, Frozen, Main | CallScreen];
    person_get(PersonIdArgs) -> PersonPage [People, Frozen, Main];
    person_create(PersonCreateArgs) -> PersonMutation [People, Frozen, Main | CallScreen];
    person_update(PersonUpdateArgs) -> PersonMutation [People, Frozen, Main];
    people_merge(PeopleMergeArgs) -> PersonMutation [People, Frozen, Main];
    /// Unnames their speakers everywhere and deletes the voice profile.
    person_delete(PersonIdArgs) -> DeleteResult [People, Frozen, Main];
    voice_profile_create(VoiceProfileArgs) -> VoiceProfileView [People, Frozen, Main];
    voice_profile_delete(PersonIdArgs) -> VoiceProfileView [People, Frozen, Main];

    // ── Agents (draft until the council gate) ─────────────────────────────
    agents_get(NoArgs) -> AgentsView [Agents, Draft, Main | Settings | FirstRun];
    agent_create(AgentCreateArgs) -> AgentMutation [Agents, Draft, Main];
    /// Edit an agent, including its runtime choice (PM-58). Takes effect at the next tick.
    agent_update(AgentUpdateArgs) -> AgentMutation [Agents, Draft, Main];
    agents_reorder(AgentsReorderArgs) -> AgentsView [Agents, Draft, Main];
    /// Only added agents; built-in ones can be disabled, not removed.
    agent_remove(AgentIdArgs) -> DeleteResult [Agents, Draft, Main];
    agent_skill_get(AgentIdArgs) -> AgentSkill [Agents, Draft, Main];
    agent_skill_save(AgentSkillSaveArgs) -> AgentSkill [Agents, Draft, Main];
    agent_skill_reset(AgentIdArgs) -> AgentSkill [Agents, Draft, Main];
    council_set_mode(CouncilModeArgs) -> AgentsView [Agents, Draft, Main];

    // ── Settings and credentials ──────────────────────────────────────────
    settings_get(NoArgs) -> Settings [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Replace one section (wanted state).
    settings_update(SettingsUpdateArgs) -> Settings [SettingsAndCredentials, Frozen, Settings | FirstRun];
    settings_unignore_app(AppIdArgs) -> Settings [SettingsAndCredentials, Frozen, Settings];
    /// Move the storage folder. Draft: available only if the engine ships unsandboxed (open question Q4);
    /// with a sandboxed engine audio and models stay in the App Group container.
    storage_move(StorageMoveArgs) -> JobAccepted [SettingsAndCredentials, Draft, Settings];
    hotkeys_list(NoArgs) -> HotkeyList [SettingsAndCredentials, Frozen, Settings];
    hotkey_set(HotkeySetArgs) -> HotkeyList [SettingsAndCredentials, Frozen, Settings];
    /// Restore Defaults: every app hotkey back to its default shortcut.
    hotkeys_reset(NoArgs) -> HotkeyList [SettingsAndCredentials, Frozen, Settings];
    repos_list(NoArgs) -> RepoList [SettingsAndCredentials, Frozen, Settings | Main];
    /// Add Mapping… from the handoff drawer opens the sheet in the main window.
    repo_upsert(RepoUpsertArgs) -> RepoList [SettingsAndCredentials, Frozen, Settings | Main];
    repo_remove(RepoIdArgs) -> RepoList [SettingsAndCredentials, Frozen, Settings];
    glossary_list(NoArgs) -> GlossaryList [SettingsAndCredentials, Frozen, Settings | Main];
    glossary_upsert(GlossaryUpsertArgs) -> GlossaryList [SettingsAndCredentials, Frozen, Settings | Main];
    glossary_remove(GlossaryIdArgs) -> GlossaryList [SettingsAndCredentials, Frozen, Settings];
    /// Privacy pane: what left this Mac, in plain words.
    audit_list(AuditListArgs) -> Page<AuditEntry> [SettingsAndCredentials, Frozen, Settings];
    audit_export(AuditExportArgs) -> ExportResult [SettingsAndCredentials, Frozen, Settings];
    /// Screen Share Test…, with the optional capture test (refused during a call).
    share_test_run(ShareTestArgs) -> ShareTestResult [SettingsAndCredentials, Frozen, Settings];
    /// Install a downloaded update now (restarts Noter).
    update_install(NoArgs) -> Ack [SettingsAndCredentials, Frozen, Settings | Main];
    accounts_get(NoArgs) -> AccountsView [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Store or replace a key: verified, then kept in the Keychain; never returned.
    api_key_set(ApiKeySetArgs) -> AccountsView [SettingsAndCredentials, Frozen, Settings | FirstRun];
    api_key_remove(KeyProviderArgs) -> AccountsView [SettingsAndCredentials, Frozen, Settings];
    /// Sign-in sheet step 1 (Prepare): is the CLI installed, is it already signed in.
    account_signin_prepare(AccountProviderArgs) -> SignInPrepare [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Install Claude Code, Codex or Ollama (progress on `jobs:progress`).
    cli_install(CliInstallArgs) -> JobAccepted [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Step 2 (Sign in): the CLI opens the browser; progress on `signin:progress`.
    account_signin_start(SignInStartArgs) -> SignInSession [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    account_signin_cancel(SignInSessionArgs) -> AccountsView [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Use This Account: bind the sign-in the CLI already has on this Mac.
    account_use_existing(AccountProviderArgs) -> AccountsView [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    /// Step 4 (Use): switch agents to the account, with Undo.
    account_bind_agents(AccountBindArgs) -> AccountBindResult [SettingsAndCredentials, Frozen, Main | Settings | FirstRun];
    account_test(AccountProviderArgs) -> AccountTestResult [SettingsAndCredentials, Frozen, Settings | FirstRun | Main];
    /// Sign out in Noter (agents fall back to the API key or pause); optionally in the CLI too.
    account_sign_out(SignOutArgs) -> AccountsView [SettingsAndCredentials, Frozen, Settings | FirstRun | Main];
    sources_list(NoArgs) -> SourceList [SettingsAndCredentials, Frozen, Settings];
    source_add_folder(SourceAddFolderArgs) -> SourceRow [SettingsAndCredentials, Frozen, Settings];
    source_add_mcp(SourceAddMcpArgs) -> SourceRow [SettingsAndCredentials, Frozen, Settings];
    source_update(SourceUpdateArgs) -> SourceRow [SettingsAndCredentials, Frozen, Settings];
    source_reindex(SourceIdArgs) -> SourceRow [SettingsAndCredentials, Frozen, Settings | Main];
    source_remove(SourceIdArgs) -> DeleteResult [SettingsAndCredentials, Frozen, Settings];
    source_revoke_token(SourceIdArgs) -> SourceRow [SettingsAndCredentials, Frozen, Settings];
    jobs_list(NoArgs) -> JobList [SettingsAndCredentials, Frozen, Settings | Main];
    /// Run now. Refused with `job_blocked` while a call is live, except post-call analysis (D2).
    job_run_now(JobIdArgs) -> JobAccepted [SettingsAndCredentials, Frozen, Settings | Main];
    /// Cancel a queued or running job run.
    job_cancel(JobIdArgs) -> JobList [SettingsAndCredentials, Frozen, Settings | Main];
    job_update(JobUpdateArgs) -> JobList [SettingsAndCredentials, Frozen, Settings];

    // ── Performance (draft) ───────────────────────────────────────────────
    perf_overview(PerfOverviewArgs) -> PerfOverview [Performance, Draft, Main];
    perf_call(CallIdArgs) -> CallPerf [Performance, Draft, Main];
    /// Export the improvement brief or open it in Claude Code or Codex.
    perf_brief(BriefArgs) -> BriefResult [Performance, Draft, Main];

    // ── First run and permissions ─────────────────────────────────────────
    setup_status(NoArgs) -> SetupStatus [FirstRunAndPermissions, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    models_download(ModelsDownloadArgs) -> SetupStatus [FirstRunAndPermissions, Frozen, FirstRun | Settings];
    /// Ask for a permission at the step that needs it (never mid-call).
    permission_request(PermissionArgs) -> PermissionRow [FirstRunAndPermissions, Frozen, FirstRun | Settings | Main];
    /// Self-test: levels and a live line stream until passed or failed (10 s).
    self_test_run(SelfTestArgs, channel: SelfTestMsg) -> SubscriptionHandle [FirstRunAndPermissions, Frozen, FirstRun | Settings | Main];
    setup_set_call_display(CallDisplayArgs) -> SetupStatus [FirstRunAndPermissions, Frozen, FirstRun | Settings];
    setup_set_audio_storage(AudioStorageArgs) -> SetupStatus [FirstRunAndPermissions, Frozen, FirstRun];
    setup_set_step(StepArgs) -> SetupStatus [FirstRunAndPermissions, Frozen, FirstRun];

    // ── Windows ───────────────────────────────────────────────────────────
    /// Open Call Screen: shows without focus; a second request makes it key (PM-40).
    window_show_call(NoArgs) -> CallWindowState [Windows, Frozen, Main | RecordPrompt | CallScreen];
    window_hide_call(NoArgs) -> CallWindowState [Windows, Frozen, CallScreen];
    window_call_state(NoArgs) -> CallWindowState [Windows, Frozen, CallScreen | Main];
    window_set_call_layout(CallLayoutArgs) -> CallWindowState [Windows, Frozen, CallScreen | Main];
    window_set_collapsed(CollapseArgs) -> CallWindowState [Windows, Frozen, CallScreen];
    window_share_warning_seen(NoArgs) -> CallWindowState [Windows, Frozen, CallScreen];
    /// Hide for Presenting (wanted state).
    app_set_hidden_for_presenting(HiddenArgs) -> PresentingState [Windows, Frozen, CallScreen | Main];
    /// Show Noter / Open in Noter at a place (main window or Settings window).
    window_navigate(NavigateArgs) -> Ack [Windows, Frozen, Main | CallScreen | RecordPrompt | Settings | FirstRun];
    /// The main window reports which call page it shows (`null` = none), so the core sends no
    /// notification for that call while the window is frontmost.
    window_report_view(ViewReportArgs) -> Ack [Windows, Frozen, Main];
    /// Native announcement for a panel that is not key (D55).
    window_announce(AnnounceArgs) -> Ack [Windows, Frozen, CallScreen | RecordPrompt];
    /// The record prompt reports its content size; the panel fits it, 360 to 440 pt wide.
    window_fit(FitArgs) -> Ack [Windows, Frozen, RecordPrompt];
    /// Open a URL, a document citation, a System Settings pane or a Finder location.
    open_external(OpenExternalArgs) -> Ack [Windows, Frozen, Main | CallScreen | Settings | FirstRun];
}

events! {
    /// The capture state machine, whole, on every change.
    CAPTURE_STATE = "capture:state" => CaptureState [Frozen];
    /// The record prompt's detection appeared, changed or went away.
    CAPTURE_DETECTED = "capture:detected" => DetectionChanged [Frozen];
    /// Copilot status for every window (menu bar mirrors are native).
    COPILOT_STATUS = "copilot:status" => CopilotStatus [Draft];
    /// Full current set of degraded states.
    DEGRADED_CHANGED = "degraded:changed" => DegradedSet [Frozen];
    /// Full current set of app banners.
    BANNERS_CHANGED = "banners:changed" => BannerSet [Frozen];
    /// A record changed for any reason; replace it by id.
    ENTITY_CHANGED = "entity:changed" => EntityChanged [Frozen];
    /// A post-call output section changed state.
    OUTPUTS_PROGRESS = "outputs:progress" => OutputsProgress [Frozen];
    /// A job run started, progressed or finished.
    JOBS_PROGRESS = "jobs:progress" => JobProgress [Frozen];
    /// Sidebar counts for Activity.
    PROPOSALS_COUNTS = "proposals:counts" => ProposalCounts [Frozen];
    SETUP_CHANGED = "setup:changed" => SetupStatus [Frozen];
    /// Displays, output route, permissions, notifications, online, update, disk.
    ENV_CHANGED = "env:changed" => EnvironmentState [Frozen];
    SETTINGS_CHANGED = "settings:changed" => Settings [Frozen];
    PRIVACY_CHANGED = "privacy:changed" => PrivacyStatus [Frozen];
    ACCOUNTS_CHANGED = "accounts:changed" => AccountsView [Frozen];
    SIGNIN_PROGRESS = "signin:progress" => SignInProgress [Frozen];
    HOTKEYS_CHANGED = "hotkeys:changed" => HotkeyList [Frozen];
    PLAYBACK_STATE = "playback:state" => PlaybackState [Frozen];
    WINDOW_CALL = "window:call" => CallWindowState [Frozen];
    APP_PRESENTING = "app:presenting" => PresentingState [Frozen];
    /// The core asks the main or Settings window to navigate (notification click, menu).
    NAV_REQUEST = "nav:request" => NavTarget [Frozen];
}

/// All types of the IPC contract, for the TypeScript exporter.
pub fn ipc_types() -> Types {
    let types = Types::default()
        .register::<crate::error::CoreError>()
        .register::<WindowLabel>()
        .register::<Stability>()
        .register::<CommandGroup>();
    register_event_types(register_command_types(types))
}

/// Find a command by name.
pub fn command(name: &str) -> Option<&'static CommandSpec> {
    COMMANDS.iter().find(|c| c.name == name)
}
