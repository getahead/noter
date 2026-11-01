//! Typed fixtures for the fake core and for contract tests.
#![allow(clippy::too_many_arguments)]
//!
//! Written in Rust on purpose: if a contract type changes, these stop
//! compiling, so the fake core the UI team works against can never drift from
//! the contract. Exported to `contracts/fixtures/world.json`.
//! "Today" is Thursday 16 October 2026, as in the clickable prototype; the
//! people and calls are the prototype's example records.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::common::*;
use crate::error::RuntimeUnavailableReason;
use crate::model::*;

/// 2026-10-16 08:00 UTC (10:00 in Munich).
pub const NOW: i64 = 1_792_137_600_000;
const MIN: i64 = 60_000;
const DAY: i64 = 86_400_000;

/// Everything the fake core serves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct FakeWorld {
    pub now: TimestampMs,
    pub app: AppSnapshot,
    pub settings: Settings,
    pub people: Vec<PersonRow>,
    pub calls: Vec<CallRow>,
    pub call_details: Vec<CallDetail>,
    pub transcripts: Vec<TranscriptSnapshot>,
    /// Played by the fake on `transcript_subscribe` for the live call, one event per `script_interval_ms`.
    pub live_script: Vec<TranscriptEvent>,
    pub script_interval_ms: u32,
    pub cards: Vec<CardView>,
    pub copilot: CopilotStatus,
    pub items: Vec<ItemView>,
    pub outputs: Vec<CallOutputs>,
    pub today: TodayView,
    pub topics: Vec<TopicRow>,
    pub changes: Vec<ChangeRow>,
    pub proposals: Vec<ProposalRow>,
    pub agents: AgentsView,
    pub sources: SourceList,
    pub jobs: JobList,
    pub hotkeys: HotkeyList,
    pub repos: RepoList,
    pub glossary: GlossaryList,
    pub call_types: CallTypeList,
    pub scope_presets: ScopePresetList,
    pub ask_threads: Vec<AskThread>,
    pub audit: Vec<AuditEntry>,
    pub performance: PerfOverview,
}

fn ts(ms: i64) -> TimestampMs {
    TimestampMs(ms)
}
fn s(v: &str) -> String {
    v.to_string()
}
fn ct(v: &str) -> CallTypeId {
    CallTypeId(s(v))
}
/// Every whole-state payload of the fixture world starts at version 1.
const V1: StateVersion = StateVersion(1);

struct P {
    id: &'static str,
    name: &'static str,
    short: &'static str,
    initials: &'static str,
    role: &'static str,
    you: bool,
    voice: bool,
}

const PEOPLE: &[P] = &[
    P {
        id: "per_you",
        name: "You",
        short: "You",
        initials: "You",
        role: "Team lead, frontend",
        you: true,
        voice: false,
    },
    P {
        id: "per_anna",
        name: "Anna Kuznetsova",
        short: "Anna K.",
        initials: "AK",
        role: "Frontend developer",
        you: false,
        voice: true,
    },
    P {
        id: "per_pavel",
        name: "Pavel Romanov",
        short: "Pavel",
        initials: "PR",
        role: "Product manager",
        you: false,
        voice: false,
    },
    P {
        id: "per_dmitri",
        name: "Dmitri Sokolov",
        short: "Dmitri S.",
        initials: "DS",
        role: "Backend lead",
        you: false,
        voice: true,
    },
    P {
        id: "per_oleg",
        name: "Oleg Morozov",
        short: "Oleg M.",
        initials: "OM",
        role: "QA engineer",
        you: false,
        voice: false,
    },
    P {
        id: "per_lena",
        name: "Lena Krüger",
        short: "Lena K.",
        initials: "LK",
        role: "Designer",
        you: false,
        voice: false,
    },
];

fn chip(id: &str) -> PersonChip {
    let p = PEOPLE.iter().find(|p| p.id == id).expect("fixture person");
    PersonChip {
        id: PersonId(s(p.id)),
        display_name: s(p.name),
        short_name: s(p.short),
        initials: s(p.initials),
        is_you: p.you,
    }
}

fn person_row(p: &P, open: u32) -> PersonRow {
    PersonRow {
        id: PersonId(s(p.id)),
        rev: Rev(1),
        display_name: s(p.name),
        short_name: s(p.short),
        initials: s(p.initials),
        email: if p.you {
            None
        } else {
            Some(format!(
                "{}@example.com",
                p.short.to_lowercase().replace(['.', ' '], "")
            ))
        },
        role: Some(s(p.role)),
        org: Some(s("Virtuozzo")),
        aliases: vec![],
        is_you: p.you,
        voice_profile: p.voice,
        last_call_at: Some(ts(NOW)),
        open_items: open,
    }
}

fn job_row(id: &str, kind: JobKind, name: &str, trigger: &str, blocked_by_call: bool) -> JobRow {
    JobRow {
        id: JobId(s(id)),
        kind,
        name: s(name),
        enabled: true,
        trigger: s(trigger),
        allow_on_battery: false,
        last_run: None,
        running: false,
        blocked_by_call,
    }
}

fn agent(id: &str, name: &str, badge: &str) -> AgentRef {
    AgentRef {
        id: AgentId(s(id)),
        name: s(name),
        badge: s(badge),
    }
}

fn call_ref(id: &str, title: &str, at: i64, ty: &str) -> CallRef {
    CallRef {
        id: CallId(s(id)),
        title: s(title),
        started_at: ts(at),
        call_type: ct(ty),
    }
}

const LIVE: &str = "call_live";
const BACKEND: &str = "call_backend";

fn live_ref() -> CallRef {
    call_ref(LIVE, "Planning: VHI 8.0 drawer redesign", NOW, "planning")
}
fn backend_ref() -> CallRef {
    call_ref(
        BACKEND,
        "Backend sync",
        NOW - 14 * DAY + 6 * 3_600_000,
        "cross_team",
    )
}

fn span(call: &str, t0_s: u32, t1_s: u32) -> TimeSpan {
    TimeSpan {
        call_id: CallId(s(call)),
        channel: None,
        t0_ms: OffsetMs(t0_s * 1000),
        t1_ms: OffsetMs(t1_s * 1000),
    }
}

fn speaker(id: &str, label: SpeakerLabel) -> SpeakerRef {
    SpeakerRef {
        speaker_id: SpeakerId(s(id)),
        label,
    }
}

fn seg(
    n: u32,
    spk: SpeakerRef,
    ch: AudioChannel,
    t0_s: u32,
    text: &str,
    lang: Lang,
    conf: f32,
    state: SegmentState,
) -> SegmentView {
    SegmentView {
        id: SegmentId(format!("seg_live_{n:03}")),
        call_id: CallId(s(LIVE)),
        channel: ch,
        speaker: spk,
        crosstalk_with: vec![],
        t0_ms: OffsetMs(t0_s * 1000),
        t1_ms: OffsetMs((t0_s + 6) * 1000),
        text: s(text),
        lang,
        lang_p: 0.93,
        confidence: conf,
        state,
        pass: TranscriptPass::Live,
        corrections: vec![],
    }
}

fn you() -> SpeakerRef {
    speaker("spk_you", SpeakerLabel::You)
}
fn named(spk: &str, person: &str) -> SpeakerRef {
    speaker(
        spk,
        SpeakerLabel::Person {
            person: chip(person),
        },
    )
}

fn item(
    id: &str,
    kind: ItemKind,
    text: &str,
    owner: Option<&str>,
    due: Option<&str>,
    review: ReviewState,
    status: ItemStatus,
    call: CallRef,
    at_s: u32,
    owed: Owed,
) -> ItemView {
    let call_id = call.id.0.clone();
    ItemView {
        id: ItemId(s(id)),
        rev: Rev(1),
        call,
        kind,
        text: s(text),
        lang: Lang::En,
        owner: owner.map(chip),
        due: due.map(|d| LocalDate(s(d))),
        status,
        review,
        created_by: CreatedBy::Llm,
        topic: Some(TopicChip {
            id: TopicId(s("top_drawer")),
            name: s("Drawer redesign"),
        }),
        is_engineering: false,
        linked_issue: None,
        spans: vec![span(&call_id, at_s, at_s + 12)],
        handoff: None,
        closed_by: None,
        done_at: None,
        owed,
        carried_from: None,
        edited: false,
    }
}

fn writer(rt: RuntimeChoice, model: &str) -> WriterInfo {
    WriterInfo {
        runtime: rt,
        model: s(model),
        skill: s("planning"),
        skill_version: s("1.0.0"),
        generated_at: ts(NOW + 50 * MIN),
        from_pass: TranscriptPass::Live,
    }
}

fn copilot_status() -> CopilotStatus {
    CopilotStatus {
        version: V1,
        call_id: Some(CallId(s(LIVE))),
        flag_on: true,
        single_agent: false,
        mode: EffectiveMode::CloudRedacted,
        council: CouncilMode::Fused,
        muted: None,
        budget: BudgetState {
            spent_usd: 0.31,
            cap_usd: 1.0,
            level: BudgetLevel::Ok,
            on_account: false,
        },
        agents: vec![
            AgentLiveState {
                agent: agent("agt_architect", "Architect", "building.columns"),
                muted: false,
                paused_reason: None,
            },
            AgentLiveState {
                agent: agent("agt_pm", "Product manager", "target"),
                muted: false,
                paused_reason: None,
            },
        ],
        card_keys: CardKeysState {
            registered: true,
            dismiss_keys: false,
            conflicts: vec![],
        },
        listening: false,
    }
}

fn accounts() -> AccountsView {
    AccountsView {
        version: V1,
        keys: vec![
            KeyView {
                provider: KeyProvider::Anthropic,
                status: KeyStatus::Configured {
                    verified_at: ts(NOW - DAY),
                },
            },
            KeyView {
                provider: KeyProvider::Codex,
                status: KeyStatus::NotSet,
            },
        ],
        accounts: vec![
            AccountView {
                provider: AccountProvider::Claude,
                status: AccountStatus::NotSignedIn,
                cli: CliInfo {
                    tool: CliTool::ClaudeCode,
                    installed: true,
                    path: Some(s("/opt/homebrew/bin/claude")),
                    version: Some(s("2.4.1")),
                    supported: true,
                },
                agents: vec![],
            },
            AccountView {
                provider: AccountProvider::Chatgpt,
                status: AccountStatus::NotSignedIn,
                cli: CliInfo {
                    tool: CliTool::Codex,
                    installed: false,
                    path: None,
                    version: None,
                    supported: false,
                },
                agents: vec![],
            },
        ],
        local: LocalRuntimeView {
            cli: CliInfo {
                tool: CliTool::Ollama,
                installed: true,
                path: Some(s("/usr/local/bin/ollama")),
                version: Some(s("0.12.3")),
                supported: true,
            },
            running: true,
            models: vec![s("qwen3:8b")],
            default_model: Some(s("qwen3:8b")),
        },
    }
}

fn setup_done() -> SetupStatus {
    let steps = [
        SetupStep::Welcome,
        SetupStep::Models,
        SetupStep::Permissions,
        SetupStep::CallDisplay,
        SetupStep::AudioStorage,
        SetupStep::Assistants,
    ]
    .into_iter()
    .map(|step| StepRow {
        step,
        state: StepState::Done,
    })
    .collect();
    SetupStatus {
        version: V1,
        complete: true,
        steps,
        models: ModelsStatus {
            bundles: vec![
                ModelBundle {
                    name: s("WhisperKit Large v3 Turbo"),
                    size_mb: 950,
                    done_mb: 950,
                    state: BundleState::Ready,
                    required_for_capture: true,
                },
                ModelBundle {
                    name: s("WhisperKit Large v3"),
                    size_mb: 1550,
                    done_mb: 1550,
                    state: BundleState::Ready,
                    required_for_capture: false,
                },
                ModelBundle {
                    name: s("FluidAudio VAD and diarization"),
                    size_mb: 120,
                    done_mb: 120,
                    state: BundleState::Ready,
                    required_for_capture: true,
                },
                ModelBundle {
                    name: s("bge-m3 (CoreML)"),
                    size_mb: 1150,
                    done_mb: 1150,
                    state: BundleState::Ready,
                    required_for_capture: false,
                },
            ],
            total_mb: 3770,
            done_mb: 3770,
            error: None,
        },
        permissions: permissions(),
        self_test: SelfTestState::Passed {
            at: ts(NOW - 2 * DAY),
        },
        call_display: Some(DisplayId(s("dsp_studio"))),
        detection_enabled: true,
    }
}

fn permissions() -> Vec<PermissionRow> {
    vec![
        PermissionRow {
            kind: PermissionKind::Microphone,
            state: PermissionState::Granted,
        },
        PermissionRow {
            kind: PermissionKind::SystemAudio,
            state: PermissionState::Granted,
        },
        PermissionRow {
            kind: PermissionKind::Calendar,
            state: PermissionState::Granted,
        },
        PermissionRow {
            kind: PermissionKind::Notifications,
            state: PermissionState::NotAsked,
        },
        PermissionRow {
            kind: PermissionKind::ScreenRecording,
            state: PermissionState::NotAsked,
        },
        PermissionRow {
            kind: PermissionKind::AutomationTerminal,
            state: PermissionState::NotAsked,
        },
        PermissionRow {
            kind: PermissionKind::AutomationBrowser,
            state: PermissionState::NotAsked,
        },
    ]
}

fn capture_recording() -> CaptureState {
    CaptureState {
        version: V1,
        phase: CapturePhase::Recording,
        call_id: Some(CallId(s(LIVE))),
        title: Some(s("Planning: VHI 8.0 drawer redesign")),
        started_at: Some(ts(NOW)),
        recorded_ms: DurationMs(23 * 60_000),
        sensitive: false,
        pause: None,
        notice: None,
        continue_until: None,
        output_route: OutputRoute::Headphones,
        replay_available: true,
        audio_not_stored: false,
        audio_writing: true,
    }
}

fn settings() -> Settings {
    Settings {
        version: V1,
        rev: Rev(1),
        general: GeneralSettings {
            storage_path: s("~/Library/Application Support/Noter"),
            storage_in_cloud_folder: false,
            ignored_apps: vec![IgnoredApp {
                bundle_id: s("com.spotify.client"),
                app_name: s("Spotify"),
            }],
            summary_language: SummaryLanguage::En,
            notifications_enabled: false,
            launch_at_login: true,
            offer_to_record: true,
        },
        audio: AudioSettings {
            live_backend: TranscriptionBackend::WhisperTurboNoterLoop,
            offline_backend: TranscriptionBackend::WhisperLargeV3,
            output: AudioOutputSettings {
                headphones_devices: vec![s("BuiltInHeadphoneOutputDevice-USB-DAC-4F2A")],
            },
            exclude_own_sounds: true,
            retention: AudioRetention::Days30,
            retention_next_run_deletes: 2,
            mic_device: None,
        },
        privacy: PrivacySettings {
            mode: PrivacyMode::CloudRedacted,
            pseudonymise_names: false,
            behaviour_metrics: false,
        },
        runtimes: RuntimeSettings {
            live_copilot: RuntimeChoice::ClaudeApiKey,
            post_call: RuntimeChoice::ClaudeApiKey,
            search_answers: RuntimeChoice::ClaudeApiKey,
            local_model: Some(s("qwen3:8b")),
        },
        copilot: CopilotSettings {
            card_keys: CardKeySettings {
                enabled: true,
                modifiers: Modifiers {
                    control: true,
                    option: true,
                    command: true,
                },
            },
            dismiss_with_keys: false,
            default_cap_usd: 1.0,
            muted_call_types: vec![],
            default_council_live: CouncilMode::Fused,
            default_council_post_call: CouncilMode::Parallel,
        },
        call_screen: CallScreenSettings {
            display_id: Some(DisplayId(s("dsp_studio"))),
            layout: CallLayoutPreference::Auto,
            open_automatically: true,
        },
        menu_bar: MenuBarSettings {
            title: MenuBarTitle::None,
            hidden_actions: vec![],
        },
        today: TodaySettings {
            horizon: DashboardHorizon::ThisWeek,
            hidden_calendars: vec![],
            ranking: TodayRanking::OwedToTodaysPeople,
        },
        performance: PerformanceSettings {
            near_pct: 90,
            over_pct: 105,
            retention_days: 365,
            sampled_stages: vec![],
        },
        maintenance: MaintenanceSettings {
            window_start: s("02:00"),
            window_end: s("05:00"),
            allow_on_battery: false,
            backups_kept: 7,
        },
        evidence: EvidenceSettings {
            jira: true,
            bitbucket: true,
            github: false,
            later_calls: true,
        },
        updates: UpdateSettings {
            channel: UpdateChannel::Stable,
            install_automatically: true,
        },
    }
}

fn agents_view() -> AgentsView {
    let mk = |id: &str, name: &str, badge: &str, order: u16, share: u8| AgentView {
        id: AgentId(s(id)),
        rev: Rev(1),
        name: s(name),
        badge: s(badge),
        builtin: true,
        enabled: true,
        order,
        runtime: RuntimeChoice::ClaudeApiKey,
        model: s("claude-haiku"),
        effort: Effort::Low,
        tools: vec![s("mcp__noter__search_calls")],
        call_types: vec![ct("planning"), ct("cross_team")],
        budget_share: share,
        status: AgentStatus::Ok,
        skill_path: format!("skills/roles/{}/SKILL.md", id.trim_start_matches("agt_")),
        stats: AgentStats {
            cards_7d: 20,
            useful_share: Some(0.34),
        },
    };
    let mut designer = mk("agt_designer", "Designer", "paintbrush", 3, 15);
    designer.runtime = RuntimeChoice::CodexApiKey;
    designer.status = AgentStatus::Paused {
        reason: RuntimeUnavailableReason::NoKey,
        fix: None,
    };
    AgentsView {
        agents: vec![
            mk("agt_pm", "Product manager", "target", 1, 20),
            mk("agt_architect", "Architect", "building.columns", 2, 20),
            designer,
            mk("agt_backend", "Backend engineer", "server.rack", 4, 15),
            mk("agt_frontend", "Frontend engineer", "macwindow", 5, 15),
            mk("agt_teamlead", "Teamlead", "person.2", 6, 15),
        ],
        council: vec![CouncilModeRow {
            call_type: ct("planning"),
            live: CouncilMode::Fused,
            post_call: CouncilMode::Parallel,
            agents: vec![],
        }],
        budget_total_pct: 100,
        runtimes: vec![
            RuntimeAvailability {
                runtime: RuntimeChoice::ClaudeApiKey,
                available: true,
                reason: None,
                models: vec![
                    ModelOption {
                        id: s("claude-haiku"),
                        label: s("Haiku"),
                        live_ok: true,
                    },
                    ModelOption {
                        id: s("claude-sonnet"),
                        label: s("Sonnet"),
                        live_ok: false,
                    },
                ],
            },
            RuntimeAvailability {
                runtime: RuntimeChoice::ClaudeAccount,
                available: false,
                reason: Some(RuntimeUnavailableReason::AccountSignedOut),
                models: vec![],
            },
            RuntimeAvailability {
                runtime: RuntimeChoice::CodexApiKey,
                available: false,
                reason: Some(RuntimeUnavailableReason::NoKey),
                models: vec![],
            },
            RuntimeAvailability {
                runtime: RuntimeChoice::ChatgptAccount,
                available: false,
                reason: Some(RuntimeUnavailableReason::CliMissing),
                models: vec![],
            },
            RuntimeAvailability {
                runtime: RuntimeChoice::Local,
                available: true,
                reason: None,
                models: vec![ModelOption {
                    id: s("qwen3:8b"),
                    label: s("Qwen3 8B"),
                    live_ok: true,
                }],
            },
        ],
        live_call: Some(CallId(s(LIVE))),
    }
}

/// Build the fixture world.
pub fn world() -> FakeWorld {
    let live = live_ref();
    let backend = backend_ref();

    let segments = vec![
        seg(
            1,
            named("spk_pavel", "per_pavel"),
            AudioChannel::Sys,
            1180,
            "The empty state for the drawer is still open. Nobody owns the copy.",
            Lang::En,
            0.97,
            SegmentState::Confirmed,
        ),
        seg(
            2,
            named("spk_anna", "per_anna"),
            AudioChannel::Sys,
            1198,
            "Я сделаю drawer redesign до пятницы.",
            Lang::Ru,
            0.94,
            SegmentState::Confirmed,
        ),
        seg(
            3,
            you(),
            AudioChannel::Mic,
            1221,
            "We parked that two weeks ago.",
            Lang::En,
            0.98,
            SegmentState::Confirmed,
        ),
        seg(
            4,
            speaker("spk_3", SpeakerLabel::Unnamed { n: 3 }),
            AudioChannel::Sys,
            1235,
            "Fast, ja. Der Kanal ist da, aber der Reconnect fehlt noch.",
            Lang::De,
            0.81,
            SegmentState::Confirmed,
        ),
        seg(
            5,
            named("spk_dmitri", "per_dmitri"),
            AudioChannel::Sys,
            1272,
            "Websocket уведомления идут через notification service, как решили второго октября.",
            Lang::Ru,
            0.92,
            SegmentState::Confirmed,
        ),
        seg(
            6,
            named("spk_pavel", "per_pavel"),
            AudioChannel::Sys,
            1300,
            "Then who writes the acceptance criteria for the reconnect handling?",
            Lang::En,
            0.96,
            SegmentState::Confirmed,
        ),
        seg(
            7,
            named("spk_dmitri", "per_dmitri"),
            AudioChannel::Sys,
            1361,
            "I will add a replay buffer on the backend, VSTOR-9912.",
            Lang::En,
            0.95,
            SegmentState::Confirmed,
        ),
        seg(
            8,
            you(),
            AudioChannel::Mic,
            1400,
            "Agreed. I will hand that off today.",
            Lang::En,
            0.99,
            SegmentState::Confirmed,
        ),
    ];
    let hypothesis = seg(
        9,
        named("spk_pavel", "per_pavel"),
        AudioChannel::Sys,
        1411,
        "I think we should ask the backend team whether…",
        Lang::En,
        0.7,
        SegmentState::Hypothesis,
    );

    let speakers = vec![
        SpeakerView {
            id: SpeakerId(s("spk_you")),
            call_id: CallId(s(LIVE)),
            label: SpeakerLabel::You,
            channel: AudioChannel::Mic,
            segment_count: 2,
            talk_ms: None,
            sample: None,
            suggestion: None,
            named_by: None,
        },
        SpeakerView {
            id: SpeakerId(s("spk_anna")),
            call_id: CallId(s(LIVE)),
            label: SpeakerLabel::Person {
                person: chip("per_anna"),
            },
            channel: AudioChannel::Sys,
            segment_count: 1,
            talk_ms: None,
            sample: Some(span(LIVE, 1198, 1204)),
            suggestion: None,
            named_by: Some(NamedBy::VoiceProfile),
        },
        SpeakerView {
            id: SpeakerId(s("spk_pavel")),
            call_id: CallId(s(LIVE)),
            label: SpeakerLabel::Person {
                person: chip("per_pavel"),
            },
            channel: AudioChannel::Sys,
            segment_count: 2,
            talk_ms: None,
            sample: Some(span(LIVE, 1180, 1186)),
            suggestion: None,
            named_by: Some(NamedBy::Calendar),
        },
        SpeakerView {
            id: SpeakerId(s("spk_dmitri")),
            call_id: CallId(s(LIVE)),
            label: SpeakerLabel::Person {
                person: chip("per_dmitri"),
            },
            channel: AudioChannel::Sys,
            segment_count: 2,
            talk_ms: None,
            sample: Some(span(LIVE, 1272, 1278)),
            suggestion: None,
            named_by: Some(NamedBy::VoiceProfile),
        },
        SpeakerView {
            id: SpeakerId(s("spk_3")),
            call_id: CallId(s(LIVE)),
            label: SpeakerLabel::Unnamed { n: 3 },
            channel: AudioChannel::Sys,
            segment_count: 1,
            talk_ms: None,
            sample: Some(span(LIVE, 1235, 1241)),
            suggestion: Some(chip("per_lena")),
            named_by: None,
        },
    ];

    let transcript = TranscriptSnapshot {
        subscription_id: None,
        call_id: CallId(s(LIVE)),
        live: true,
        pass: TranscriptPass::Live,
        archive: ArchiveStatus::NotStarted,
        segments: segments.clone(),
        hypotheses: vec![hypothesis.clone()],
        marks: vec![MarkView {
            id: MarkId(s("mrk_1")),
            call_id: CallId(s(LIVE)),
            at_ms: OffsetMs(1_260_000),
            note: None,
        }],
        gaps: vec![GapView {
            call_id: CallId(s(LIVE)),
            t0_ms: OffsetMs(1_330_000),
            t1_ms: OffsetMs(1_360_000),
            reason: GapReason::Paused,
        }],
        speakers: speakers.clone(),
        last_seq: Seq(42),
        audio_available: true,
    };

    // The past call as the Library and the call page read it back: an archive-pass transcript,
    // whose speakers, mark and gap the call detail repeats (fixture parity, M1).
    let past_speaker =
        |id: &str, label: SpeakerLabel, channel: AudioChannel, segment_count: u32| SpeakerView {
            id: SpeakerId(s(id)),
            call_id: CallId(s(BACKEND)),
            label,
            channel,
            segment_count,
            talk_ms: None,
            sample: None,
            suggestion: None,
            named_by: Some(NamedBy::Calendar),
        };
    let past_speakers = vec![
        past_speaker("spk_b_you", SpeakerLabel::You, AudioChannel::Mic, 1),
        past_speaker(
            "spk_b_dmitri",
            SpeakerLabel::Person {
                person: chip("per_dmitri"),
            },
            AudioChannel::Sys,
            1,
        ),
    ];
    let past_seg = |n: u32, speaker_at: usize, t0_s: u32, text: &str, lang: Lang| {
        let spk = &past_speakers[speaker_at];
        SegmentView {
            id: SegmentId(format!("seg_backend_{n:03}")),
            call_id: CallId(s(BACKEND)),
            channel: spk.channel,
            speaker: speaker(spk.id.as_str(), spk.label.clone()),
            crosstalk_with: vec![],
            t0_ms: OffsetMs(t0_s * 1000),
            t1_ms: OffsetMs((t0_s + 8) * 1000),
            text: s(text),
            lang,
            lang_p: 0.95,
            confidence: 0.96,
            state: SegmentState::Confirmed,
            pass: TranscriptPass::Archive,
            corrections: vec![],
        }
    };
    let past_transcript = TranscriptSnapshot {
        subscription_id: None,
        call_id: CallId(s(BACKEND)),
        live: false,
        pass: TranscriptPass::Archive,
        archive: ArchiveStatus::Done,
        segments: vec![
            past_seg(
                1,
                1,
                12,
                "Давайте начнём с ostor: что с бакетами после рестарта?",
                Lang::Ru,
            ),
            past_seg(
                2,
                0,
                40,
                "Can we keep serving reads while it rebuilds?",
                Lang::En,
            ),
        ],
        hypotheses: vec![],
        marks: vec![MarkView {
            id: MarkId(s("mrk_b_1")),
            call_id: CallId(s(BACKEND)),
            at_ms: OffsetMs(41_000),
            note: None,
        }],
        gaps: vec![GapView {
            call_id: CallId(s(BACKEND)),
            t0_ms: OffsetMs(30_000),
            t1_ms: OffsetMs(33_000),
            reason: GapReason::DeviceChanged,
        }],
        speakers: past_speakers.clone(),
        // The last sequence number the call's stream reached before it stopped.
        last_seq: Seq(17),
        audio_available: true,
    };

    let mut confirmed = hypothesis.clone();
    confirmed.state = SegmentState::Confirmed;
    confirmed.text =
        s("I think we should ask the backend team whether the buffer survives a restart.");
    confirmed.confidence = 0.93;
    let live_script = vec![
        TranscriptEvent::Hypothesis {
            segment: hypothesis.clone(),
        },
        TranscriptEvent::Confirmed { segment: confirmed },
        TranscriptEvent::Hypothesis {
            segment: seg(
                10,
                named("spk_anna", "per_anna"),
                AudioChannel::Sys,
                1420,
                "Ja, und",
                Lang::De,
                0.6,
                SegmentState::Hypothesis,
            ),
        },
        TranscriptEvent::Confirmed {
            segment: seg(
                10,
                named("spk_anna", "per_anna"),
                AudioChannel::Sys,
                1420,
                "Ja, und ich prüfe die Fokusreihenfolge mit VoiceOver.",
                Lang::De,
                0.9,
                SegmentState::Confirmed,
            ),
        },
        TranscriptEvent::Mark {
            mark: MarkView {
                id: MarkId(s("mrk_2")),
                call_id: CallId(s(LIVE)),
                at_ms: OffsetMs(1_430_000),
                note: None,
            },
        },
    ];

    let items = vec![
        item(
            "itm_spec",
            ItemKind::ActionItem,
            "Drawer redesign spec by Friday",
            Some("per_anna"),
            Some("2026-10-17"),
            ReviewState::Accepted,
            ItemStatus::Open,
            live.clone(),
            1198,
            Owed::ToYou,
        ),
        {
            let mut i = item(
                "itm_replay",
                ItemKind::ActionItem,
                "Replay buffer for websocket reconnects",
                Some("per_dmitri"),
                Some("2026-10-22"),
                ReviewState::Suggested,
                ItemStatus::Open,
                live.clone(),
                1361,
                Owed::ToYou,
            );
            i.is_engineering = true;
            i.linked_issue = Some(s("VSTOR-9912"));
            i
        },
        {
            let mut i = item(
                "itm_virt",
                ItemKind::ActionItem,
                "Virtualise the 10k-row table in the drawer list",
                Some("per_you"),
                Some("2026-10-16"),
                ReviewState::Accepted,
                ItemStatus::HandedOff,
                live.clone(),
                1400,
                Owed::ByYou,
            );
            i.is_engineering = true;
            i.linked_issue = Some(s("VSTOR-1234"));
            i.handoff = Some(HandoffSummary {
                target: HandoffTarget::ClaudeCode,
                at: ts(NOW + 65 * MIN),
                cwd: s("~/projects/vhp-frontend"),
                awaiting: true,
            });
            i
        },
        item(
            "itm_a11y",
            ItemKind::ActionItem,
            "Check drawer focus order with VoiceOver",
            Some("per_anna"),
            Some("2026-10-20"),
            ReviewState::Suggested,
            ItemStatus::Open,
            live.clone(),
            1420,
            Owed::ToYou,
        ),
        item(
            "itm_notif",
            ItemKind::Decision,
            "Drawer events go through the notification service.",
            Some("per_dmitri"),
            None,
            ReviewState::Accepted,
            ItemStatus::Open,
            live.clone(),
            1272,
            Owed::Other,
        ),
        item(
            "itm_reconnect_q",
            ItemKind::OpenQuestion,
            "Who owns the acceptance criteria for the reconnect?",
            None,
            None,
            ReviewState::Suggested,
            ItemStatus::Open,
            live.clone(),
            1300,
            Owed::Other,
        ),
        {
            let mut i = item(
                "itm_token",
                ItemKind::ActionItem,
                "Rotate the staging Jira token",
                Some("per_you"),
                Some("2026-10-15"),
                ReviewState::Accepted,
                ItemStatus::ClosedByEvidence,
                backend.clone(),
                2850,
                Owed::ByYou,
            );
            i.linked_issue = Some(s("VSTOR-9790"));
            i.closed_by = Some(EvidenceView {
                id: EvidenceId(s("evd_1")),
                source: EvidenceSource::Jira,
                reference: s("VSTOR-9790"),
                url: Some(s("https://jira.example.com/browse/VSTOR-9790")),
                span: None,
                summary: s("VSTOR-9790 moved to Done on 16 Oct"),
                confidence: ConfidenceLevel::High,
                dated_at: ts(NOW - 5 * 3_600_000),
                collected_at: ts(NOW - 4 * 3_600_000),
                closed_item: true,
            });
            i.done_at = Some(ts(NOW - 4 * 3_600_000));
            i
        },
        {
            let mut i = item(
                "itm_retention_q",
                ItemKind::OpenQuestion,
                "How long do we keep monitoring data?",
                Some("per_oleg"),
                None,
                ReviewState::Accepted,
                ItemStatus::AnsweredInCall,
                backend.clone(),
                3010,
                Owed::Other,
            );
            i.done_at = Some(backend.started_at);
            i
        },
    ];

    let calls = vec![
        CallRow {
            id: CallId(s(LIVE)),
            rev: Rev(3),
            title: live.title.clone(),
            call_type: ct("planning"),
            started_at: ts(NOW),
            duration_ms: DurationMs(23 * 60_000),
            platform: Some(s("Microsoft Teams")),
            participants: vec![
                chip("per_anna"),
                chip("per_pavel"),
                chip("per_dmitri"),
                chip("per_you"),
            ],
            unnamed_speakers: 1,
            languages: vec![Lang::En, Lang::Ru, Lang::De],
            tags: vec![s("vhi-8.0")],
            privacy: PrivacyClass::Normal,
            status: CallStatus::Recording,
            outputs: OutputsStatus::NotStarted,
            archive: ArchiveStatus::NotStarted,
            audio_kept_until: Some(ts(NOW + 30 * DAY)),
            audio_deleted: false,
            audio_deleted_at: None,
            audio_retention_days: 30,
            open_items: 5,
            review_waiting: 3,
        },
        CallRow {
            id: CallId(s(BACKEND)),
            rev: Rev(5),
            title: backend.title.clone(),
            call_type: ct("cross_team"),
            started_at: backend.started_at,
            duration_ms: DurationMs(52 * 60_000),
            platform: Some(s("Zoom")),
            participants: vec![chip("per_dmitri"), chip("per_oleg"), chip("per_you")],
            unnamed_speakers: 0,
            languages: vec![Lang::Ru, Lang::En],
            tags: vec![s("backend")],
            privacy: PrivacyClass::Normal,
            status: CallStatus::Ready,
            outputs: OutputsStatus::Ready,
            archive: ArchiveStatus::Done,
            audio_kept_until: Some(ts(NOW + 16 * DAY)),
            audio_deleted: false,
            audio_deleted_at: None,
            audio_retention_days: 30,
            open_items: 1,
            review_waiting: 0,
        },
    ];

    let backend_outputs = CallOutputs {
        call_id: CallId(s(BACKEND)),
        status: OutputsStatus::Ready,
        sections: vec![
            OutputSection {
                kind: SectionKind::Summary,
                state: SectionState::Ready,
                summary_id: Some(SummaryId(s("sum_backend"))),
                rev: Some(Rev(2)),
                body_md: Some(s("Backend and QA aligned on the websocket notifications. Drawer events will go through the notification service; the reconnect owner is still open.")),
                items: vec![],
                reviews: vec![],
                writer: Some(writer(RuntimeChoice::ClaudeApiKey, "claude-sonnet")),
                user_edited: false,
                regenerated_with_edits: false,
                version_count: 2,
            },
            OutputSection {
                kind: SectionKind::ActionItems,
                state: SectionState::Ready,
                summary_id: None,
                rev: None,
                body_md: None,
                items: vec![items[6].clone()],
                reviews: vec![],
                writer: Some(writer(RuntimeChoice::ClaudeApiKey, "claude-sonnet")),
                user_edited: false,
                regenerated_with_edits: false,
                version_count: 1,
            },
            OutputSection {
                kind: SectionKind::RoleReviews,
                state: SectionState::Writing,
                summary_id: None,
                rev: None,
                body_md: None,
                items: vec![],
                reviews: vec![],
                writer: None,
                user_edited: false,
                regenerated_with_edits: false,
                version_count: 0,
            },
        ],
        archive: ArchiveStatus::Done,
        review_waiting: 0,
        sensitive: false,
        written_locally: false,
    };

    let cards = vec![
        CardView {
            id: CardId(s("card_1")),
            call_id: CallId(s(LIVE)),
            number: Some(1),
            kind: CardKind::Context,
            agent: agent("agt_architect", "Architect", "building.columns"),
            merged_agents: vec![],
            title: s("On 2 Oct you and Dmitri S. agreed drawer events go through the notification service."),
            body: None,
            provenance: Some(Provenance::PastCall { call: backend.clone(), span: span(BACKEND, 2470, 2482) }),
            state: CardState::Shown,
            solicited: false,
            lang: Lang::En,
            created_at: ts(NOW + 21 * MIN),
            expires_at: Some(ts(NOW + 21 * MIN + 90_000)),
            rating: None,
            carry_forward: None,
            used: false,
        },
        CardView {
            id: CardId(s("card_2")),
            call_id: CallId(s(LIVE)),
            number: Some(2),
            kind: CardKind::Ask,
            agent: agent("agt_pm", "Product manager", "target"),
            merged_agents: vec![agent("agt_designer", "Designer", "paintbrush")],
            title: s("Who owns the acceptance criteria for the reconnect handling?"),
            body: None,
            provenance: Some(Provenance::ThisCall { span: span(LIVE, 1300, 1306) }),
            state: CardState::Shown,
            solicited: false,
            lang: Lang::En,
            created_at: ts(NOW + 22 * MIN),
            expires_at: Some(ts(NOW + 22 * MIN + 90_000)),
            rating: None,
            carry_forward: None,
            used: false,
        },
        CardView {
            id: CardId(s("card_3")),
            call_id: CallId(s(LIVE)),
            number: Some(3),
            kind: CardKind::Answer,
            agent: agent("agt_teamlead", "Teamlead", "person.2"),
            merged_agents: vec![],
            title: s("Retention of monitoring data is probably 90 days."),
            body: None,
            provenance: Some(Provenance::ModelGuess),
            state: CardState::Shown,
            solicited: false,
            lang: Lang::En,
            created_at: ts(NOW + 23 * MIN),
            expires_at: Some(ts(NOW + 23 * MIN + 90_000)),
            rating: None,
            carry_forward: None,
            used: false,
        },
        // An earlier card: expired after the topic moved on; the user asked its question aloud.
        CardView {
            id: CardId(s("card_0")),
            call_id: CallId(s(LIVE)),
            number: None,
            kind: CardKind::Ask,
            agent: agent("agt_pm", "Product manager", "target"),
            merged_agents: vec![],
            title: s("Is the 480 pt drawer width agreed with design?"),
            body: None,
            provenance: Some(Provenance::ThisCall { span: span(LIVE, 1120, 1130) }),
            state: CardState::Expired,
            solicited: false,
            lang: Lang::En,
            created_at: ts(NOW + 19 * MIN),
            expires_at: Some(ts(NOW + 19 * MIN + 90_000)),
            rating: None,
            carry_forward: None,
            used: true,
        },
    ];

    let proposals = vec![
        ProposalRow {
            id: ChangeId(s("chg_prop_1")),
            rev: Rev(1),
            batch_id: None,
            kind: ProposalKind::CloseItem,
            title: s("Close “Virtualise the 10k-row table…”"),
            reason: s("PR #448 merged with VSTOR-1234 on 16 Oct"),
            target: EntityRef {
                kind: EntityKind::Item,
                id: s("itm_virt"),
                label: s("Virtualise the 10k-row table in the drawer list"),
            },
            confidence: ConfidenceLevel::Medium,
            count: 1,
            evidence: vec![],
            created_at: ts(NOW - 3 * 3_600_000),
            term: None,
        },
        ProposalRow {
            id: ChangeId(s("chg_prop_2")),
            rev: Rev(1),
            batch_id: Some(BatchId(s("bat_ostor"))),
            kind: ProposalKind::ApplyTerm,
            title: s("Apply term “ostor” to 14 transcripts"),
            reason: s("You corrected “o-store” to “ostor” 3 times"),
            target: EntityRef {
                kind: EntityKind::Glossary,
                id: s("gls_ostor"),
                label: s("ostor"),
            },
            confidence: ConfidenceLevel::High,
            count: 14,
            evidence: vec![],
            created_at: ts(NOW - 6 * 3_600_000),
            term: Some(s("ostor")),
        },
    ];

    let changes = vec![
        ChangeRow {
            id: ChangeId(s("chg_1")),
            batch_id: None,
            batch_size: 1,
            at: ts(NOW - 4 * 3_600_000),
            actor: Actor::Job {
                job_id: JobId(s("job_evidence")),
                name: s("Evidence collection"),
            },
            entity: EntityRef {
                kind: EntityKind::Item,
                id: s("itm_token"),
                label: s("Rotate the staging Jira token"),
            },
            field: Some(s("status")),
            before: Some(s("open")),
            after: Some(s("closed_by_evidence")),
            summary: s("Closed “Rotate the staging Jira token”"),
            reason: Some(s("VSTOR-9790 moved to Done")),
            evidence: vec![],
            confidence: Some(ConfidenceLevel::High),
            status: ChangeStatus::Applied,
            undoable: true,
            redoable: false,
        },
        ChangeRow {
            id: ChangeId(s("chg_2")),
            batch_id: Some(BatchId(s("bat_shaman"))),
            batch_size: 37,
            at: ts(NOW - 5 * 3_600_000),
            actor: Actor::Job {
                job_id: JobId(s("job_reconcile")),
                name: s("Reconcile terms and references"),
            },
            entity: EntityRef {
                kind: EntityKind::Glossary,
                id: s("gls_shaman"),
                label: s("shaman"),
            },
            field: Some(s("text")),
            before: None,
            after: None,
            summary: s("Applied term “shaman” to 37 segments"),
            reason: Some(s("Always for this term")),
            evidence: vec![],
            confidence: Some(ConfidenceLevel::High),
            status: ChangeStatus::Applied,
            undoable: true,
            redoable: false,
        },
        // Undone yesterday and not edited since: History offers **Redo**.
        ChangeRow {
            id: ChangeId(s("chg_3")),
            batch_id: Some(BatchId(s("bat_people"))),
            batch_size: 4,
            at: ts(NOW - DAY),
            actor: Actor::Job {
                job_id: JobId(s("job_reconcile_people")),
                name: s("Reconcile people"),
            },
            entity: EntityRef {
                kind: EntityKind::Speaker,
                id: s("spk_3"),
                label: s("Speaker 3"),
            },
            field: Some(s("person")),
            before: None,
            after: Some(s("Lena Krüger")),
            summary: s("Named Speaker 3 as Lena K. in 4 calls"),
            reason: Some(s("Voice matches Lena K.'s profile")),
            evidence: vec![],
            confidence: Some(ConfidenceLevel::Medium),
            status: ChangeStatus::Undone,
            undoable: false,
            redoable: true,
        },
    ];

    let topics = vec![
        TopicRow {
            id: TopicId(s("top_drawer")),
            rev: Rev(1),
            name: s("Drawer redesign"),
            aliases: vec![],
            calls: 6,
            decisions: 3,
            open_items: 2,
            last_seen: ts(NOW),
            merge_suggestion: None,
        },
        TopicRow {
            id: TopicId(s("top_ws")),
            rev: Rev(1),
            name: s("Websocket notifications"),
            aliases: vec![],
            calls: 4,
            decisions: 2,
            open_items: 1,
            last_seen: ts(NOW),
            merge_suggestion: Some(TopicChip {
                id: TopicId(s("top_notif")),
                name: s("Notification service"),
            }),
        },
        TopicRow {
            id: TopicId(s("top_notif")),
            rev: Rev(1),
            name: s("Notification service"),
            aliases: vec![],
            calls: 5,
            decisions: 2,
            open_items: 1,
            last_seen: backend.started_at,
            merge_suggestion: None,
        },
    ];

    let today = TodayView {
        date: LocalDate(s("2026-10-16")),
        ranking: TodayRanking::OwedToTodaysPeople,
        calendar: CalendarAccess::Granted,
        live_call: Some(calls[0].clone()),
        today: vec![UpcomingCall {
            event_id: CalendarEventId(s("evt_1on1_anna")),
            title: s("1:1 with Anna K."),
            starts_at: ts(NOW + 270 * MIN),
            ends_at: ts(NOW + 300 * MIN),
            platform: Some(s("Microsoft Teams")),
            attendees: vec![AttendeeChip {
                person: Some(chip("per_anna")),
                name: s("Anna Kuznetsova"),
                email: None,
            }],
            sensitive: false,
            call_id: None,
            last_time: Some(LastTimeLine {
                call: call_ref(
                    "call_1on1_anna",
                    "1:1 with Anna K.",
                    NOW - 7 * DAY,
                    "one_on_one",
                ),
                line: s("Agreed on Friday for the spec"),
            }),
            items: vec![items[0].clone(), items[3].clone()],
            questions: vec![],
            handed_off: vec![],
            open_count: 2,
        }],
        this_week: vec![],
        due_without_call: vec![],
        done_today: vec![items[6].clone()],
        review_waiting: 3,
        proposals: proposals.clone(),
        proposals_total: 2,
        banners: vec![],
        first_use: false,
    };

    let people = PEOPLE
        .iter()
        .map(|p| person_row(p, if p.you { 1 } else { 2 }))
        .collect();
    let copilot = copilot_status();
    let acc = accounts();

    let app = AppSnapshot {
        contract_version: s(crate::CONTRACT_VERSION),
        app_version: s("0.1.0-dev"),
        window: WindowLabel::Main,
        setup: setup_done(),
        capture: capture_recording(),
        detection: DetectionChanged {
            version: V1,
            detection: None,
        },
        copilot: Some(copilot.clone()),
        privacy: PrivacyStatus {
            version: V1,
            mode: PrivacyMode::CloudRedacted,
            effective: EffectiveMode::CloudRedacted,
        },
        presenting: PresentingState {
            version: V1,
            hidden: false,
        },
        degraded: DegradedSet {
            version: V1,
            states: vec![],
        },
        accounts: acc,
        features: FeatureFlags {
            copilot: true,
            council: true,
            screen_context: false,
            behaviour_metrics: false,
        },
        prefs: UiPrefs {
            time_format: TimeFormat::H24,
            first_weekday: 1,
            time_zone: s("Europe/Berlin"),
        },
        proposals: ProposalCounts {
            version: V1,
            waiting: 2,
            needs_attention: 0,
        },
        banners: BannerSet {
            version: V1,
            banners: vec![],
        },
        environment: EnvironmentState {
            version: V1,
            displays: vec![
                DisplayInfo {
                    id: DisplayId(s("dsp_builtin")),
                    name: s("Built-in Retina Display"),
                    is_main: true,
                    holds_call_app: true,
                    width_pt: 1512,
                    height_pt: 982,
                },
                DisplayInfo {
                    id: DisplayId(s("dsp_studio")),
                    name: s("Studio Display"),
                    is_main: false,
                    holds_call_app: false,
                    width_pt: 2560,
                    height_pt: 1440,
                },
            ],
            output_route: OutputRoute::Headphones,
            output_device: Some(OutputDeviceInfo {
                uid: s("BuiltInHeadphoneOutputDevice"),
                name: s("External Headphones"),
                marked_headphones: false,
            }),
            permissions: permissions(),
            notifications: NotificationAuth::NotDetermined,
            online: true,
            update: None,
            disk_free_mb: 182_000,
        },
    };

    FakeWorld {
        now: ts(NOW),
        app,
        settings: settings(),
        people,
        // One detail per call, repeating its row and its transcript's speakers, marks and gaps,
        // as a core reading the rows back serves them (fixture parity, M1).
        call_details: [(&calls[0], &transcript), (&calls[1], &past_transcript)]
            .into_iter()
            .map(|(call, t)| CallDetail {
                call: call.clone(),
                calendar_event: None,
                speakers: t.speakers.clone(),
                marks: t.marks.clone(),
                gaps: t.gaps.clone(),
                mode_used: EffectiveMode::CloudRedacted,
                audio_not_stored: false,
                first_recorded_call: false,
                folder: format!(
                    "/Users/you/Library/Application Support/Noter/audio/{}",
                    call.id.as_str()
                ),
            })
            .collect(),
        transcripts: vec![transcript, past_transcript],
        calls,
        live_script,
        script_interval_ms: 1500,
        cards,
        copilot,
        items,
        outputs: vec![backend_outputs],
        today,
        topics,
        changes,
        proposals,
        agents: agents_view(),
        sources: SourceList {
            sources: vec![SourceRow {
                id: SourceId(s("src_specs")),
                rev: Rev(1),
                kind: SourceKind::Folder,
                name: s("Frontend specs"),
                location: s("~/Documents/specs"),
                mode: SourceMode::Indexed,
                schedule: None,
                privacy: PrivacyClass::Normal,
                scope: SourceScope::AllCalls,
                status: SourceStatus::Idle,
                documents: 128,
                last_sync_at: Some(ts(NOW - 2 * 3_600_000)),
                has_token: false,
            }],
        },
        jobs: JobList {
            jobs: vec![
                JobRow {
                    id: JobId(s("job_evidence")),
                    kind: JobKind::EvidenceCollection,
                    name: s("Evidence collection"),
                    enabled: true,
                    trigger: s("Hourly while items are open, after each call"),
                    allow_on_battery: false,
                    last_run: Some(JobRunRow {
                        id: JobRunId(s("run_1")),
                        job_id: JobId(s("job_evidence")),
                        kind: JobKind::EvidenceCollection,
                        name: s("Evidence collection"),
                        started_at: ts(NOW - 4 * 3_600_000),
                        finished_at: Some(ts(NOW - 4 * 3_600_000 + 40_000)),
                        status: JobRunStatus::Succeeded,
                        counts: vec![
                            CountEntry {
                                label: s("closed"),
                                n: 1,
                            },
                            CountEntry {
                                label: s("proposed"),
                                n: 1,
                            },
                        ],
                        error: None,
                        progress: None,
                    }),
                    running: false,
                    blocked_by_call: true,
                },
                job_row(
                    "job_post_call",
                    JobKind::PostCall,
                    "Post-call analysis",
                    "After each call",
                    false,
                ),
                job_row(
                    "job_archive",
                    JobKind::ArchivePass,
                    "Archive transcript",
                    "After each call",
                    true,
                ),
                job_row(
                    "job_retention",
                    JobKind::Retention,
                    "Retention",
                    "Nightly",
                    true,
                ),
                job_row("job_backup", JobKind::Backup, "Backup", "Nightly", true),
            ],
            evidence_tools: vec![CliInfo {
                tool: CliTool::ClaudeCode,
                installed: true,
                path: Some(s("/opt/homebrew/bin/claude")),
                version: Some(s("2.4.1")),
                supported: true,
            }],
        },
        hotkeys: HotkeyList {
            version: V1,
            bindings: vec![
                HotkeyBinding {
                    action: HotkeyAction::StartStop,
                    shortcut: Some(s("Ctrl+Alt+Super+R")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+R")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::OpenCallScreen,
                    shortcut: Some(s("Ctrl+Alt+Super+N")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+N")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::Pause,
                    shortcut: Some(s("Ctrl+Alt+Super+P")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+P")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::MarkMoment,
                    shortcut: Some(s("Ctrl+Alt+Super+M")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+M")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::CatchMeUp,
                    shortcut: Some(s("Ctrl+Alt+Super+C")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+C")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::AskAboutCall,
                    shortcut: Some(s("Ctrl+Alt+Super+A")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+A")),
                    status: HotkeyStatus::Conflict {
                        owner: Some(s("Raycast")),
                    },
                },
                HotkeyBinding {
                    action: HotkeyAction::HideForPresenting,
                    shortcut: Some(s("Ctrl+Alt+Super+0")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+0")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::MuteCopilot,
                    shortcut: Some(s("Ctrl+Alt+Super+K")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+K")),
                    status: HotkeyStatus::Registered,
                },
                HotkeyBinding {
                    action: HotkeyAction::UndoCardAction,
                    shortcut: Some(s("Ctrl+Alt+Super+Z")),
                    default_shortcut: Some(s("Ctrl+Alt+Super+Z")),
                    status: HotkeyStatus::RegisteredDuringCapture,
                },
            ],
        },
        repos: RepoList {
            mappings: vec![RepoMapping {
                id: RepoMappingId(s("rep_vstor")),
                key: s("VSTOR"),
                local_path: s("~/projects/vhp-frontend"),
                default_tool: HandoffTarget::ClaudeCode,
                path_exists: true,
            }],
        },
        glossary: GlossaryList {
            terms: vec![GlossaryTerm {
                id: GlossaryTermId(s("gls_vhi")),
                rev: Rev(1),
                term: s("VHI"),
                variants_latin: vec![s("V H I")],
                variants_cyrillic: vec![s("ви-эйч-ай")],
                spoken_forms: vec![s("vee aitch eye")],
                lang: None,
                always_apply: false,
                added_from: None,
            }],
        },
        call_types: CallTypeList {
            call_types: [
                "one_on_one",
                "standup",
                "planning",
                "retro",
                "cross_team",
                "vendor",
                "interview",
                "incident",
            ]
            .iter()
            .map(|t| CallTypeInfo {
                id: ct(t),
                label: t.replace('_', " "),
                builtin: true,
                skill_path: format!("skills/{t}/SKILL.md"),
            })
            .collect(),
        },
        scope_presets: ScopePresetList {
            presets: vec![
                ScopePreset {
                    id: s("all"),
                    label: s("All calls and all sources"),
                    scope: AskScope {
                        include_documents: true,
                        ..Default::default()
                    },
                },
                ScopePreset {
                    id: s("calls_only"),
                    label: s("All calls, no documents"),
                    scope: AskScope::default(),
                },
            ],
        },
        ask_threads: vec![AskThread {
            id: AskThreadId(s("ask_notif")),
            title: s("What did we decide about drawer notifications?"),
            scope: AskScope {
                include_documents: true,
                ..Default::default()
            },
            turns: vec![AskAnswer {
                turn_id: AskTurnId(s("turn_notif_1")),
                question: s("What did we decide about drawer notifications?"),
                answer_md: s("Drawer events go through the notification service [1]."),
                citations: vec![Citation {
                    n: 1,
                    provenance: Provenance::PastCall {
                        call: backend.clone(),
                        span: span(BACKEND, 2470, 2482),
                    },
                    quote: s("Websocket notifications go through the notification service."),
                    speaker: Some(chip("per_dmitri")),
                    strength: MatchStrength::Strong,
                    deleted: false,
                }],
                found: true,
                runtime: RuntimeChoice::ClaudeApiKey,
                answered_locally: false,
                sensitive_sources_skipped: 0,
                keyword_only: false,
                only_weak_evidence: false,
                asked_at: ts(NOW - DAY),
            }],
        }],
        audit: vec![
            AuditEntry {
                id: AuditId(s("aud_1")),
                kind: AuditKind::Run,
                llm_run_id: Some(LlmRunId(s("llm_tick_14"))),
                at: ts(NOW + 14 * MIN),
                call: Some(live.clone()),
                runtime: Some(RuntimeChoice::ClaudeApiKey),
                destination: s("api.anthropic.com"),
                what: AuditWhat::TranscriptDelta,
                bytes_out: 1843,
                redacted: true,
            },
            AuditEntry {
                id: AuditId(s("aud_2")),
                kind: AuditKind::ToolResult,
                llm_run_id: Some(LlmRunId(s("llm_tick_14"))),
                at: ts(NOW + 14 * MIN + 2_000),
                call: Some(backend.clone()),
                runtime: Some(RuntimeChoice::ClaudeApiKey),
                destination: s("api.anthropic.com"),
                what: AuditWhat::FullTranscript,
                bytes_out: 612,
                redacted: true,
            },
        ],
        performance: PerfOverview {
            tiles: vec![MetricTile {
                metric: s("answer_card"),
                label: s("Answer card"),
                unit: s("s"),
                p95: Some(8.1),
                target: 9.0,
                blocker: false,
                state: BudgetLevelState::Near,
                trend: vec![7.2, 7.9, 8.4, 8.1],
            }],
            bottlenecks: vec![Bottleneck {
                stage: s("confirmed_text"),
                component: s("engine"),
                agent: None,
                over: 3,
                near: 11,
                example_calls: vec![backend],
            }],
            calls_measured: 18,
            roll_up_failed: false,
        },
    }
}

/// One example line per engine command and event. The contract exporter writes them to
/// `engine-lines.json` in the fixtures folder and the engine's Swift tests decode them, so a
/// change to an engine type fails `just contract` until the file is regenerated.
pub mod engine_lines {
    use crate::common::{AudioChannel, CallId, Lang, OffsetMs, TimestampMs};
    use crate::engine::*;

    fn call() -> CallId {
        CallId::new("call_1")
    }

    fn glossary() -> GlossaryEntry {
        GlossaryEntry {
            term: "Noter".into(),
            variants_latin: vec!["Notter".into()],
            variants_cyrillic: vec!["Ноутер".into()],
            spoken_forms: vec!["no-ter".into()],
        }
    }

    /// In declaration order of `EngineCommand`.
    pub fn commands() -> Vec<EngineCommandLine> {
        let cmds = vec![
            EngineCommand::Ping,
            EngineCommand::StartSession(StartSession {
                call_id: call(),
                session_dir: "audio/call_1".into(),
                store_audio: true,
                mic_device_uid: Some("BuiltInMicrophoneDevice".into()),
                exclude_bundle_ids: vec!["com.apple.Music".into()],
                languages: vec![Lang::En, Lang::Other { code: "fr".into() }],
                backend: AsrBackend::ParakeetTdtV3,
                glossary: vec![glossary()],
                speaker_priors: vec![SpeakerPrior {
                    label: "spk_1".into(),
                    en: 0.5,
                    ru: 0.25,
                    de: 0.25,
                }],
                enrolled_embeddings_path: Some("engine-io/enrolled.f32".into()),
                resume_from_ms: Some(OffsetMs(9_000)),
            }),
            EngineCommand::Pause { call_id: call() },
            EngineCommand::Resume { call_id: call() },
            EngineCommand::Stop { call_id: call() },
            EngineCommand::SetGlossary {
                entries: vec![glossary()],
            },
            EngineCommand::SetLanguages {
                languages: vec![Lang::Ru, Lang::De],
            },
            EngineCommand::ExcludeProcess {
                call_id: call(),
                bundle_id: "us.zoom.xos".into(),
            },
            EngineCommand::OfflinePass {
                call_id: call(),
                session_dir: "audio/call_1".into(),
                result_path: "audio/call_1/offline.json".into(),
                constraints_path: None,
                backend: AsrBackend::WhisperLargeV3,
            },
            EngineCommand::SpeakerEmbedding {
                request_id: "req_1".into(),
                call_id: call(),
                channel: AudioChannel::Sys,
                spans: vec![EngineSpan {
                    t0_ms: OffsetMs(1_000),
                    t1_ms: OffsetMs(2_500),
                }],
                out_path: "engine-io/emb.f32".into(),
            },
            EngineCommand::EmbedTexts {
                request_id: "req_2".into(),
                texts: vec!["hello".into()],
                out_path: None,
            },
            EngineCommand::SetDetection {
                enabled: true,
                known_bundle_ids: vec!["us.zoom.xos".into()],
            },
            EngineCommand::SelfTest {
                play_clip: false,
                timeout_ms: 10_000,
            },
            EngineCommand::Play {
                call_id: call(),
                from_ms: OffsetMs(0),
                to_ms: Some(OffsetMs(5_000)),
                channel: Some(AudioChannel::Mic),
            },
            EngineCommand::StopPlayback,
            EngineCommand::Shutdown,
        ];
        cmds.into_iter()
            .zip(1..)
            .map(|(cmd, id)| EngineCommandLine { id, cmd })
            .collect()
    }

    /// In declaration order of `EngineEvent`.
    pub fn events() -> Vec<EngineEventLine> {
        let events = vec![
            EngineEvent::Ready {
                protocol_version: ENGINE_PROTOCOL_VERSION.into(),
                engine_version: "0.1.0".into(),
                models: vec!["whisper-turbo".into()],
                sandboxed: true,
            },
            EngineEvent::Ack { cmd_id: 2 },
            EngineEvent::Error {
                cmd_id: None,
                code: EngineErrorCode::DeviceUnavailable,
                message: "mic.wav".into(),
            },
            EngineEvent::CallDetected {
                bundle_id: "us.zoom.xos".into(),
                app_name: "zoom.us".into(),
                pid: 4242,
            },
            EngineEvent::CallAudioReleased {
                bundle_id: "us.zoom.xos".into(),
            },
            EngineEvent::AudioSourceAdded {
                call_id: call(),
                bundle_id: "com.apple.Safari".into(),
                app_name: "Safari".into(),
            },
            EngineEvent::SessionStarted {
                call_id: call(),
                mic_device: "MacBook Microphone".into(),
                output_device: "MacBook Speakers".into(),
            },
            EngineEvent::DeviceChanged {
                call_id: call(),
                device_name: "AirPods".into(),
                gap_from_ms: OffsetMs(100),
                gap_to_ms: OffsetMs(900),
            },
            EngineEvent::SystemAudioSilent {
                call_id: call(),
                since_ms: OffsetMs(3_000),
                confidence: 0.75,
            },
            EngineEvent::Segment {
                segment: EngineSegment {
                    id: "eseg_1".into(),
                    call_id: call(),
                    channel: AudioChannel::Mic,
                    t0_ms: OffsetMs(1_000),
                    t1_ms: OffsetMs(2_500),
                    state: EngineSegmentState::Confirmed,
                    lang: Lang::En,
                    lang_p: 0.5,
                    speaker_label: "you".into(),
                    text: "hello".into(),
                    words_path: Some("audio/call_1/words/eseg_1.json".into()),
                    avg_logprob: -0.25,
                    no_speech_p: 0.125,
                    corrections: vec![EngineCorrection {
                        from: "notter".into(),
                        to: "Noter".into(),
                    }],
                    crosstalk_labels: vec!["spk_1".into(), "spk_2".into()],
                },
            },
            EngineEvent::SpeakerTurn {
                call_id: call(),
                channel: AudioChannel::Sys,
                speaker_label: "spk_3".into(),
                at_ms: OffsetMs(4_000),
            },
            EngineEvent::Levels {
                call_id: None,
                mic_db: -20.5,
                sys_db: -160.0,
            },
            EngineEvent::NoSegments {
                call_id: call(),
                since_ms: OffsetMs(8_000),
            },
            EngineEvent::Silence {
                call_id: call(),
                since_ms: OffsetMs(12_000),
            },
            EngineEvent::SessionStopped {
                call_id: call(),
                timeline_path: "audio/call_1/timeline.json".into(),
                mic_path: Some("audio/call_1/mic.wav".into()),
                sys_path: None,
            },
            EngineEvent::OfflineProgress {
                call_id: call(),
                progress: 0.5,
            },
            EngineEvent::OfflineDone {
                call_id: call(),
                result_path: "audio/call_1/offline.json".into(),
            },
            EngineEvent::OfflineFailed {
                call_id: call(),
                code: EngineErrorCode::ModelLoadFailed,
            },
            EngineEvent::SpeakerEmbeddingDone {
                request_id: "req_1".into(),
                out_path: "engine-io/emb.f32".into(),
            },
            EngineEvent::Embeddings {
                request_id: "req_2".into(),
                inline: Some(vec![0.5, -0.25]),
                out_path: None,
                count: 1,
            },
            EngineEvent::SelfTestStream {
                channel: AudioChannel::Sys,
            },
            EngineEvent::SelfTestLine {
                channel: AudioChannel::Mic,
                text: "one two three".into(),
            },
            EngineEvent::SelfTestResult {
                passed: false,
                failure: Some(EngineErrorCode::ZeroBuffers),
                own_sounds_leak: false,
            },
            EngineEvent::PlaybackPosition {
                call_id: call(),
                at_ms: OffsetMs(1_500),
                playing: true,
            },
            EngineEvent::Pong,
        ];
        events
            .into_iter()
            .zip(1..)
            .map(|(event, seq)| EngineEventLine {
                seq,
                at: TimestampMs(1_790_000_000_000),
                event,
            })
            .collect()
    }

    fn archive_segment(id: &str, channel: AudioChannel, t0: u32, label: &str) -> EngineSegment {
        EngineSegment {
            id: id.into(),
            call_id: call(),
            channel,
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t0 + 1_500),
            state: EngineSegmentState::Confirmed,
            lang: Lang::En,
            lang_p: 0.875,
            speaker_label: label.into(),
            text: "hello".into(),
            words_path: Some(format!("audio/call_1/words/{id}.json")),
            avg_logprob: -0.25,
            no_speech_p: 0.125,
            corrections: Vec::new(),
            crosstalk_labels: Vec::new(),
        }
    }

    /// Examples of the archive result file `offline_done` names.
    pub fn archive_results() -> Vec<ArchiveResult> {
        let mut overlap = archive_segment("aseg_2", AudioChannel::Sys, 2_000, "spk_1");
        overlap.crosstalk_labels = vec!["spk_1".into(), "spk_2".into()];
        overlap.corrections = vec![EngineCorrection {
            from: "notter".into(),
            to: "Noter".into(),
        }];
        vec![ArchiveResult {
            call_id: call(),
            backend: AsrBackend::WhisperLargeV3,
            segments: vec![
                archive_segment("aseg_1", AudioChannel::Mic, 1_000, "you"),
                overlap,
            ],
        }]
    }

    /// An example constraints file (`constraints_path`).
    pub fn constraints() -> Vec<OfflineConstraints> {
        let span = |t0: u32, t1: u32| EngineSpan {
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t1),
        };
        vec![OfflineConstraints {
            languages: vec![Lang::En, Lang::Other { code: "fr".into() }],
            glossary: vec![glossary()],
            speaker_priors: vec![SpeakerPrior {
                label: "spk_1".into(),
                en: 0.75,
                ru: 0.25,
                de: 0.0,
            }],
            must_link: vec![SpanLink {
                a: span(1_000, 2_000),
                b: span(5_000, 6_500),
            }],
            cannot_link: vec![SpanLink {
                a: span(1_000, 2_000),
                b: span(9_000, 9_800),
            }],
            speaker_names: [("spk_1".to_string(), "Anna K.".to_string())].into(),
        }]
    }

    /// An example word-timings file (`words_path`).
    pub fn words() -> Vec<EngineWord> {
        vec![EngineWord {
            t0_ms: OffsetMs(1_000),
            t1_ms: OffsetMs(1_400),
            text: "hello".into(),
            p: 0.75,
        }]
    }
}
