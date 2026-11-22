//! The real core behind the wire (`cpt-noter-algo-core-harness-boot`): a fresh
//! `noter_core::Core` in a temporary data folder, scripted platform seams instead of the Mac,
//! the fixture world seeded through the core's own commands, and the scenario controls
//! `harness.world_get`, `harness.world_set` and `harness.push` (docs/TEST-PLAN.md).
//!
//! The fixture is seeded with the public commands (`settings_update` per section,
//! `glossary_upsert`, `setup_set_step`, `setup_set_call_display`) and `Core::set_banners`, so it
//! goes through the same change-logged write path a user's edit takes; the Mac's side
//! (permissions, displays, reachability, disk, update) lives in the scripted seams.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use noter_core::{
    Adapters, BoxFuture as CoreFuture, BundleFile, BundleSpec, CalendarAttendee, CalendarEvent,
    CaptureEvent, ChunkSink, ClipboardText, Clock, Core, CoreDeps, EnvironmentReading,
    EventEmitter, FetchError, LaunchRequest, MemorySecrets, ModelSource, NativeOps, NativeServices,
    Placement, SaveKind, Scripted, ScriptedAccountCli, ScriptedMcp, ScriptedServer,
    ShortcutRegistrar, ShortcutTaken, Surfaces, SystemClock, ToolScript, TrayModel, Updater,
};
use noter_engine_client::scripted::{Behaviour, Script, ScriptedEngine};
use noter_protocol::engine::{EngineErrorCode, EngineEvent, EngineSegment, EngineSegmentState};
use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::fixtures::{world, FakeWorld};
use noter_protocol::ipc::{dispatch_json, Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::{
    AudioChannel, CallId, CoreError, DetectionId, DurationMs, EffectiveMode, ErrorCode,
    PermissionKind, PermissionState, TimestampMs,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{lock, BoxFuture, Controls, Lines};

#[path = "doubles.rs"]
mod doubles;
pub use doubles::LaunchWorld;
use doubles::*;

#[path = "seed.rs"]
mod seed;
use seed::change_row;

/// Command-line options of the harness.
#[derive(Debug, Clone, Default)]
pub struct Options {
    /// `--fixture world`: seed the fixture world of noter-protocol.
    pub fixture: bool,
    /// `--clock fixed`: the core's clock stands at the fixture's `now`.
    pub fixed_clock: bool,
    /// `--engine-script <file>`: the scripted engine plays these steps (`.plans/engine-script-format.md`).
    pub engine_script: Option<Script>,
    /// A named state of the fixture world ([`scenario`]), applied with `world_set` once seeded.
    pub scenario: Option<String>,
    /// `--llm-script <file>`: the scripted runtime answers these lines (TL-13); without it each
    /// skill answers a built-in valid output.
    pub llm_script: Option<Scripted>,
    /// The Mac's own displays, for the app's launch hooks: its real windows are drawn on them, so
    /// once seeded the scripted Mac has these displays (a display change, as when one unplugs).
    pub displays: Option<Vec<DisplayInfo>>,
    /// `--power battery`: the Mac runs on battery, so the jobs that need mains power wait.
    pub battery: bool,
    /// The native app's scripted launch plan and failures (`NOTER_TEST_LAUNCH_WORLD`).
    pub launch_world: Option<LaunchWorld>,
    /// Folder-panel answers (`NOTER_TEST_FOLDER_PANELS`): null cancels; exhaustion cancels.
    pub folder_panels: Option<VecDeque<Option<PathBuf>>>,
    /// `--hotkey-conflict <shortcut>=<owner>`: the scripted host refuses one initial chord.
    pub hotkey_conflict: Option<(String, String)>,
}

impl Options {
    /// The command line: `--fixture world` (the fixture world of noter-protocol), `--clock fixed`,
    /// `--engine-script <file>` (the scripted engine's steps) and `--llm-script <file>` (the
    /// scripted runtime's answers); a bad file is `Err` with its line.
    // @cpt-begin:cpt-noter-flow-core-harness-session:p1:inst-start
    pub fn parse(args: &[String]) -> Result<Options, String> {
        let mut options = Options::default();
        let mut rest = args.iter();
        while let Some(flag) = rest.next() {
            match (flag.as_str(), rest.next().map(String::as_str)) {
                ("--fixture", Some("world")) => options.fixture = true,
                ("--fixture", name) => {
                    return Err(format!("unknown fixture {name:?}; known: world"));
                }
                ("--clock", Some("fixed")) => options.fixed_clock = true,
                ("--hotkey-conflict", Some(value)) => {
                    let (shortcut, owner) = value
                        .split_once('=')
                        .filter(|(shortcut, owner)| !shortcut.is_empty() && !owner.is_empty())
                        .ok_or_else(|| "--hotkey-conflict needs <shortcut>=<owner>".to_string())?;
                    options.hotkey_conflict = Some((shortcut.to_string(), owner.to_string()));
                }
                ("--llm-script", Some(file)) => {
                    let text = std::fs::read_to_string(file)
                        .map_err(|e| format!("llm script {file}: {e}"))?;
                    let script =
                        Scripted::parse(&text).map_err(|e| format!("llm script {file}: {e}"))?;
                    options.llm_script = Some(script);
                }
                ("--power", Some(source @ ("battery" | "ac"))) => {
                    options.battery = source == "battery";
                }
                ("--engine-script", Some(file)) => {
                    let text = std::fs::read_to_string(file)
                        .map_err(|e| format!("engine script {file}: {e}"))?;
                    let script =
                        Script::parse(&text).map_err(|e| format!("engine script {file}: {e}"))?;
                    options.engine_script = Some(script);
                }
                _ => {
                    return Err(format!(
                        "unknown arguments {args:?}; usage: noter-core-harness [--fixture world] [--clock fixed] [--power battery|ac] [--hotkey-conflict <shortcut>=<owner>] [--engine-script <file>] [--llm-script <file>]"
                    ));
                }
            }
        }
        Ok(options)
    }
    // @cpt-end:cpt-noter-flow-core-harness-session:p1:inst-start

    /// The app's launch hooks, read with `var`: `None` unless `NOTER_TEST_FIXTURE` is set, to
    /// `world` (the fixture world) or `none` (a fresh install); `NOTER_TEST_CLOCK=fixed`,
    /// `NOTER_TEST_ENGINE_SCRIPT=<file>` and `NOTER_TEST_SCENARIO=<name>` as the flags say.
    /// `NOTER_TEST_LAUNCH_WORLD` is the JSON accepted by `harness.launch_world`;
    /// `NOTER_TEST_FOLDER_PANELS` is a JSON array of absolute chosen paths or null cancellations.
    /// Chosen folders must already exist: these answers never create them.
    pub fn from_env(var: impl Fn(&str) -> Option<String>) -> Result<Option<Options>, String> {
        let Some(fixture) = var("NOTER_TEST_FIXTURE") else {
            return Ok(None);
        };
        let mut args = vec![];
        if fixture != "none" {
            args.extend(["--fixture".to_string(), fixture]);
        }
        if let Some(clock) = var("NOTER_TEST_CLOCK") {
            args.extend(["--clock".to_string(), clock]);
        }
        if let Some(file) = var("NOTER_TEST_ENGINE_SCRIPT") {
            args.extend(["--engine-script".to_string(), file]);
        }
        let mut options = Options::parse(&args)?;
        if let Some(name) = var("NOTER_TEST_SCENARIO") {
            if !options.fixture {
                return Err(format!("scenario {name}: needs NOTER_TEST_FIXTURE=world"));
            }
            scenario(&name, TimestampMs(0), &mut world())?;
            options.scenario = Some(name);
        }
        // @cpt-dod:cpt-noter-dod-core-handoff-tests:p1
        if let Some(value) = var("NOTER_TEST_LAUNCH_WORLD") {
            options.launch_world = Some(
                serde_json::from_str(&value)
                    .map_err(|e| format!("NOTER_TEST_LAUNCH_WORLD: {e}"))?,
            );
        }
        if let Some(value) = var("NOTER_TEST_FOLDER_PANELS") {
            let answers: VecDeque<Option<PathBuf>> = serde_json::from_str(&value)
                .map_err(|e| format!("NOTER_TEST_FOLDER_PANELS: {e}"))?;
            if answers.iter().flatten().any(|path| !path.is_absolute()) {
                return Err("NOTER_TEST_FOLDER_PANELS: chosen paths must be absolute".into());
            }
            options.folder_panels = Some(answers);
        }
        Ok(Some(options))
    }
}

/// Puts the fixture world (a live call recording) in a state the native UI tests start from,
/// with its times counted from `now`.
pub fn scenario(name: &str, now: TimestampMs, w: &mut FakeWorld) -> Result<(), String> {
    let idle = CaptureState {
        phase: CapturePhase::Idle,
        call_id: None,
        title: None,
        started_at: None,
        recorded_ms: DurationMs(0),
        pause: None,
        notice: None,
        continue_until: None,
        audio_writing: false,
        ..w.app.capture.clone()
    };
    let at = |ms: i64| TimestampMs(now.0 + ms);
    match name {
        "idle" => w.app.capture = idle,
        // @cpt-seq:cpt-noter-seq-menu-bar-control-recording:p1
        "paused-5-min" => {
            w.app.capture.phase = CapturePhase::Paused;
            w.app.capture.pause = Some(PauseInfo {
                since: at(-300_000),
                remind_at: Some(now),
            });
            for call in w
                .calls
                .iter_mut()
                .chain(w.call_details.iter_mut().map(|detail| &mut detail.call))
            {
                if Some(&call.id) == w.app.capture.call_id.as_ref() {
                    call.status = CallStatus::Paused;
                }
            }
        }
        // @cpt-seq:cpt-noter-seq-call-page-hand-off-item:p1
        "handoff" => {
            w.app.capture = idle;
            // Put the engineering item on the saved call's page, where native tests can open it.
            let outputs = w
                .outputs
                .iter_mut()
                .find(|o| o.call_id.as_str() == "call_backend")
                .ok_or("handoff scenario: missing saved-call outputs")?;
            let actions = outputs
                .sections
                .iter_mut()
                .find(|s| s.kind == SectionKind::ActionItems)
                .ok_or("handoff scenario: missing action items")?;
            let item = w
                .items
                .iter_mut()
                .find(|i| i.id.as_str() == "itm_replay")
                .ok_or("handoff scenario: missing engineering item")?;
            item.call.id = outputs.call_id.clone();
            item.call.title = "Backend sync".into();
            actions.items.retain(|i| i.id != item.id);
            actions.items.push(item.clone());
        }
        // The native app-menu review test covers every current M2 item kind in one ready call.
        "menu-review" => {
            w.app.capture = idle;
            let backend = CallId::new("call_backend");
            for id in ["itm_replay", "itm_notif", "itm_reconnect_q"] {
                let item = w
                    .items
                    .iter_mut()
                    .find(|item| item.id.as_str() == id)
                    .ok_or_else(|| format!("menu-review scenario: missing {id}"))?;
                item.call.id = backend.clone();
                item.call.title = "Backend sync".into();
                item.review = ReviewState::Suggested;
                item.status = ItemStatus::Open;
            }
            let by_id = |id: &str| {
                w.items
                    .iter()
                    .find(|item| item.id.as_str() == id)
                    .cloned()
                    .unwrap()
            };
            let action_item = by_id("itm_replay");
            let decision = by_id("itm_notif");
            let question = by_id("itm_reconnect_q");
            let call = w
                .calls
                .iter_mut()
                .find(|call| call.id == backend)
                .ok_or("menu-review scenario: missing Backend sync call")?;
            call.status = CallStatus::Ready;
            call.outputs = OutputsStatus::Ready;
            call.open_items = 3;
            call.review_waiting = 3;
            let detail = w
                .call_details
                .iter_mut()
                .find(|detail| detail.call.id == backend)
                .ok_or("menu-review scenario: missing Backend sync details")?;
            detail.call.status = CallStatus::Ready;
            detail.call.outputs = OutputsStatus::Ready;
            detail.call.open_items = 3;
            detail.call.review_waiting = 3;
            let outputs = w
                .outputs
                .iter_mut()
                .find(|outputs| outputs.call_id == backend)
                .ok_or("menu-review scenario: missing Backend sync outputs")?;
            let action_index = outputs
                .sections
                .iter()
                .position(|section| section.kind == SectionKind::ActionItems)
                .ok_or("menu-review scenario: missing Action Items section")?;
            outputs.sections[action_index].items = vec![action_item];
            let mut decisions = outputs.sections[action_index].clone();
            decisions.kind = SectionKind::Decisions;
            decisions.items = vec![decision];
            let mut questions = outputs.sections[action_index].clone();
            questions.kind = SectionKind::OpenQuestions;
            questions.items = vec![question];
            outputs.sections.insert(action_index, decisions);
            outputs.sections.insert(action_index + 2, questions);
            outputs.review_waiting = 3;
        }
        "low-disk" => {
            w.app.capture = idle;
            w.app.environment.disk_free_mb = 100;
        }
        "detected" => {
            w.app.capture = idle;
            w.app.detection.detection = Some(CallDetection {
                id: DetectionId::new("det_harness"),
                app_name: "zoom.us".into(),
                bundle_id: "us.zoom.xos".into(),
                matched_event: None,
                detected_at: now,
                prompt_until: at(15_000),
                blocked: None,
            });
        }
        "new-meeting" => {
            w.app.capture.notice = Some(CaptureNotice::NewMeeting {
                event: None,
                app_name: Some("zoom.us".into()),
                detected_at: now,
                expires_at: at(60_000),
                default_choice: NewMeetingChoice::StartAsNewCall,
            })
        }
        "call-seems-ended" => {
            w.app.presenting.hidden = true;
            w.app.capture.notice = Some(CaptureNotice::CallSeemsEnded {
                stops_at: at(600_000),
            });
        }
        "switched-to-local" => {
            w.app.degraded.states = vec![DegradedState::SwitchedToLocal {
                call_id: w.app.capture.call_id.clone(),
                reason: RuntimeUnavailableReason::RateLimited,
                retry_at: None,
            }];
            w.app.privacy.effective = EffectiveMode::SwitchedToLocal;
        }
        "first-call" => {
            // After the first recorded call: the library holds only “Backend sync”, nothing records.
            w.app.capture = idle;
            let first = |id: &CallId| id.as_str() == "call_backend";
            w.calls.retain(|c| first(&c.id));
            w.call_details.retain(|d| first(&d.call.id));
            w.transcripts.retain(|t| first(&t.call_id));
        }
        _ => {
            return Err(format!(
                "unknown scenario {name}; known: idle, paused-5-min, handoff, menu-review, low-disk, detected, new-meeting, call-seems-ended, switched-to-local, first-call"
            ));
        }
    }
    Ok(())
}

/// The harness around one real core.
pub struct Harness {
    core: Arc<Core>,
    native: Arc<ScriptedNative>,
    updater: Arc<ScriptedUpdater>,
    models: Arc<TinyModels>,
    engine: ScriptedEngine,
    surfaces: Arc<ScriptedSurfaces>,
    /// The Keychain stand-in (TL-13).
    secrets: Arc<MemorySecrets>,
    /// Claude Code, Codex and Ollama as accounts and installs (TL-32).
    account_cli: ScriptedAccountCli,
    /// The indexed MCP servers (TL-42); none until `harness.mcp_server` adds one.
    mcp: Arc<ScriptedMcp>,
    /// The scripted runtime, for `harness.llm_next`.
    llm: Scripted,
    /// The core's clock and the milliseconds `harness.advance_clock` added to it.
    clock: Arc<dyn Clock>,
    skew: Arc<AtomicI64>,
    panel: Arc<ScriptedPanel>,
    /// The last world `world_set` accepted, for the slices no M0 service owns.
    world: Mutex<FakeWorld>,
    dir: PathBuf,
}

impl Harness {
    /// Boots the core; `Err` with the reason when the data folder or the store cannot open.
    // @cpt-algo:cpt-noter-algo-core-harness-boot:p1
    pub async fn start(options: Options, lines: Lines) -> Result<Arc<Harness>, String> {
        Self::start_with(options, Arc::new(lines), |deps| deps).await
    }

    /// [`Harness::start`] for the app's launch hooks: the core's events go to `events` and `host`
    /// puts the app's own seams (windows, hotkeys, version) over the scripted ones.
    pub async fn start_with(
        options: Options,
        events: Arc<dyn EventEmitter>,
        host: impl FnOnce(CoreDeps) -> CoreDeps,
    ) -> Result<Arc<Harness>, String> {
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-temp-dir
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "noter-core-harness-{}-{}-{n}",
            std::process::id(),
            nanos()
        ));
        std::fs::create_dir_all(dir.join("models")).map_err(|e| e.to_string())?;
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-temp-dir
        let w = if options.fixture {
            world()
        } else {
            blank(world())
        };
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-inject
        let native = Arc::new(ScriptedNative::new(&w.app.environment));
        let updater = Arc::new(ScriptedUpdater {
            ready: Mutex::new(w.app.environment.update.clone()),
            failure: Mutex::new(None),
        });
        let models = Arc::new(TinyModels::new(&w.app.setup.models, native.clone()));
        models
            .place(&dir.join("models"), &w.app.setup.models)
            .map_err(|e| e.to_string())?;
        let skew = Arc::new(AtomicI64::new(0));
        let base: Arc<dyn Clock> = if options.fixed_clock {
            Arc::new(Fixed(w.now))
        } else {
            Arc::new(SystemClock)
        };
        let clock: Arc<dyn Clock> = Arc::new(Skewed(base, skew.clone()));
        // Boot and seeding go through the core's commands; a window's snapshot already holds their
        // result, so their events stay off the wire (`seeding` is cleared before `Ok`).
        let seeding = Arc::new(AtomicBool::new(true));
        // The self-test takes a moment, so a window can watch it and a scenario can push into it.
        // The data folder is the engine's folder too: the offline pass and the
        // embeddings write their built-in answers there.
        let engine = ScriptedEngine::new()
            .with_default(Behaviour {
                self_test_pace_ms: 300,
                self_test_line: Some("Welcome to Noter".into()),
                answer_capture_sessions: true,
                ..Behaviour::default()
            })
            .with_container(dir.to_path_buf());
        let engine = match options.engine_script {
            Some(script) => engine.with_script(script),
            None => engine,
        };
        engine.set_system_audio(system_audio(&w.app.setup.permissions));
        let surfaces = Arc::new(ScriptedSurfaces::default());
        let scripted = options.llm_script.clone().unwrap_or_default();
        let llm = Adapters::scripted(&scripted);
        let secrets = Arc::new(MemorySecrets::default());
        let account_cli = ScriptedAccountCli::new();
        scripted.follow(&account_cli);
        let now = clock.clone();
        let mcp = Arc::new(ScriptedMcp::new(Arc::new(move || now.now())));
        let panel = Arc::new(ScriptedPanel {
            dir: dir.join("exports"),
            cancel_next: AtomicBool::new(false),
            launch: Mutex::new(options.launch_world.unwrap_or_default()),
            folder_panels: Mutex::new(options.folder_panels),
            log: Mutex::new(json!({ "launches": [], "clipboard": [] })),
            probe_fails: Mutex::new(None),
        });
        let deps = CoreDeps {
            shortcuts: Arc::new(ScriptedShortcuts(options.hotkey_conflict.clone())),
            native: native.clone(),
            models: models.clone(),
            engine: Arc::new(engine.clone()),
            updater: updater.clone(),
            surfaces: surfaces.clone(),
            llm,
            secrets: secrets.clone(),
            account_cli: Arc::new(account_cli.clone()),
            native_ops: panel.clone(),
            mcp_source: mcp.clone(),
            ..CoreDeps::new(clock.clone(), Arc::new(EventLines(events, seeding.clone())))
        };
        let deps = if options.battery {
            CoreDeps {
                power: Arc::new(OnBattery),
                ..deps
            }
        } else {
            deps
        };
        let deps = host(deps);
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-inject
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-open-store
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-build-core
        let core = Arc::new(Core::open(&dir, deps).map_err(|e| e.to_string())?);
        core.start_first_run();
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-build-core
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-open-store
        let harness = Arc::new(Harness {
            core,
            native,
            updater,
            models,
            engine,
            surfaces,
            secrets,
            account_cli,
            mcp,
            llm: scripted,
            clock: clock.clone(),
            skew,
            panel,
            world: Mutex::new(w.clone()),
            dir,
        });
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-if-fixture
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-seed
        if options.fixture {
            harness
                .seed(&w)
                .await
                .map_err(|e| format!("seeding the fixture world: {}", e.message))?;
        }
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-seed
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-if-fixture
        if let Some(name) = &options.scenario {
            let failed = |e: CoreError| format!("scenario {name}: {}", e.message);
            let mut w: FakeWorld =
                serde_json::from_value(harness.world_get().await.map_err(failed)?)
                    .map_err(|e| format!("scenario {name}: {e}"))?;
            scenario(name, clock.now(), &mut w)?;
            harness
                .world_set(json!({ "world": w }))
                .await
                .map_err(failed)?;
        }
        if let Some(displays) = options.displays {
            harness.native.update(|r| r.displays = displays);
            harness.native.changed();
        }
        if options.fixture {
            harness.feed_engine();
        }
        seeding.store(false, Ordering::SeqCst);
        // @cpt-begin:cpt-noter-algo-core-harness-boot:p1:inst-return-booted
        eprintln!("noter-core-harness: core open in {}", harness.dir.display());
        Ok(harness)
        // @cpt-end:cpt-noter-algo-core-harness-boot:p1:inst-return-booted
    }

    /// The engine's meters: levels every 100 ms, for the call being captured or (none) the mic
    /// check, and while the fixture's own live call records, its current hypotheses every 300 ms,
    /// so a window subscribed to it sees a stream that moves. Nothing is delivered until the
    /// engine runs (subscribing to a stream starts it). Confirmed lines are not invented: they
    /// would add rows the fixture does not have.
    fn feed_engine(self: &Arc<Self>) {
        let (core, engine) = (self.core.clone(), self.engine.clone());
        let harness = Arc::downgrade(self);
        tokio::spawn(async move {
            for tick in 0_u64.. {
                let capturing = noter_core::testing::capturing(&core);
                engine.inject(EngineEvent::Levels {
                    call_id: capturing.clone(),
                    mic_db: -32.0,
                    sys_db: -38.0,
                });
                let Some(harness) = harness.upgrade() else {
                    return;
                };
                // The hypotheses of the call being captured, from the last accepted world: a
                // `world_set` that empties them leaves the stream waiting for speech.
                if let Some(call) = capturing.filter(|_| tick % 3 == 0) {
                    let hypotheses: Vec<EngineSegment> = lock(&harness.world)
                        .transcripts
                        .iter()
                        .filter(|t| t.call_id == call)
                        .flat_map(|t| t.hypotheses.iter())
                        .map(|h| engine_segment(h, EngineSegmentState::Hypothesis))
                        .collect();
                    for h in hypotheses {
                        engine.inject(EngineEvent::Segment { segment: h });
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        });
    }

    /// The core, for `serve_with`.
    pub fn core(&self) -> Arc<Core> {
        self.core.clone()
    }

    async fn call(&self, window: WindowLabel, cmd: &str, args: Value) -> Result<Value, CoreError> {
        dispatch_json(
            &*self.core,
            &CommandCtx {
                caller: Caller::Window { label: window },
            },
            cmd,
            args,
            None,
        )
        .await
    }

    /// `harness.push { cmd, body: { event } }`: the scripted engine says it. For `self_test_run`
    /// the core rebuilds the failure channel from the streams that arrived, so a silent channel
    /// is pushed as the other channel's stream followed by a failed result. For
    /// `transcript_subscribe` a hypothesis or confirmed line is the engine's segment (the core
    /// assigns a confirmed line its own id), and a gap or mark is the session's event after its
    /// commit. Returns the seq the Channel message gets, which the core assigns, so always `null`.
    async fn push(&self, args: Value) -> Result<Value, CoreError> {
        let bad =
            |what: &str| CoreError::new(ErrorCode::InvalidInput, format!("harness.push: {what}"));
        let mut body = args["body"]["event"].clone();
        if args["cmd"] == "transcript_subscribe" {
            let event: TranscriptEvent =
                serde_json::from_value(body).map_err(|e| bad(&e.to_string()))?;
            let segment = match event {
                TranscriptEvent::Hypothesis { segment, .. } => {
                    self.remember_line(&segment, false);
                    engine_segment(&segment, EngineSegmentState::Hypothesis)
                }
                TranscriptEvent::Confirmed { segment, .. } => {
                    self.remember_line(&segment, true);
                    engine_segment(&segment, EngineSegmentState::Confirmed)
                }
                TranscriptEvent::Ended { reason } => {
                    let call = noter_core::testing::capturing(&self.core)
                        .ok_or_else(|| bad("no live call has a stream to end"))?;
                    noter_core::testing::end_transcript_stream(&self.core, &call, reason);
                    return Ok(Value::Null);
                }
                TranscriptEvent::Gap { gap } => {
                    noter_core::testing::capture_event(&self.core, CaptureEvent::Gap(gap));
                    return Ok(Value::Null);
                }
                TranscriptEvent::Mark { mark } => {
                    noter_core::testing::capture_event(&self.core, CaptureEvent::Mark(mark));
                    return Ok(Value::Null);
                }
                _ => {
                    return Err(CoreError::new(
                        ErrorCode::NotImplemented,
                        "harness.push: transcript_subscribe plays hypothesis, confirmed, gap, mark and ended",
                    ));
                }
            };
            self.inject(vec![EngineEvent::Segment { segment }]).await?;
            return Ok(Value::Null);
        }
        if args["cmd"] != "self_test_run" {
            return Err(CoreError::new(
                ErrorCode::NotImplemented,
                "harness.push: only self_test_run and transcript_subscribe have a scripted stream",
            ));
        }
        // The scenario says "no system audio" with null; the engine's levels are decibels.
        if body["type"] == "levels" && body["sys_db"].is_null() {
            body["sys_db"] = json!(-120.0);
        }
        let event: SelfTestEvent = serde_json::from_value(body).map_err(|e| bad(&e.to_string()))?;
        let result = |passed, failure, own_sounds_leak| EngineEvent::SelfTestResult {
            passed,
            failure,
            own_sounds_leak,
        };
        let events = match event {
            SelfTestEvent::Levels { mic_db, sys_db } => vec![EngineEvent::Levels {
                call_id: None,
                mic_db,
                sys_db,
            }],
            SelfTestEvent::Line { channel, text } => {
                vec![EngineEvent::SelfTestLine { channel, text }]
            }
            SelfTestEvent::StreamArrived { channel } => {
                vec![EngineEvent::SelfTestStream { channel }]
            }
            SelfTestEvent::Passed => vec![result(true, None, false)],
            SelfTestEvent::Failed { reason } => match reason {
                SelfTestFailure::OneStreamSilent { channel } => vec![
                    EngineEvent::SelfTestStream {
                        channel: match channel {
                            AudioChannel::Mic => AudioChannel::Sys,
                            AudioChannel::Sys => AudioChannel::Mic,
                        },
                    },
                    result(false, Some(EngineErrorCode::Internal), false),
                ],
                SelfTestFailure::OwnSoundsLeak => vec![result(false, None, true)],
                SelfTestFailure::ZeroBuffers => {
                    vec![result(false, Some(EngineErrorCode::ZeroBuffers), false)]
                }
                SelfTestFailure::PermissionMissing { .. } => {
                    vec![result(
                        false,
                        Some(EngineErrorCode::PermissionMissing),
                        false,
                    )]
                }
                _ => vec![result(false, Some(EngineErrorCode::Internal), false)],
            },
            // The core ends its stream itself when the self-test is over.
            SelfTestEvent::Ended { .. } => vec![],
        };
        self.inject(events).await?;
        Ok(Value::Null)
    }

    /// A pushed line is what the scripted engine now repeats for its channel: a hypothesis
    /// replaces the repeating one, a confirmed line ends it (as the core removes the hypothesis
    /// it confirms).
    fn remember_line(&self, segment: &SegmentView, confirmed: bool) {
        let mut w = lock(&self.world);
        if let Some(t) = w
            .transcripts
            .iter_mut()
            .find(|t| t.call_id == segment.call_id)
        {
            t.hypotheses.retain(|h| h.channel != segment.channel);
            if !confirmed {
                t.hypotheses.push(segment.clone());
            }
        }
    }

    /// The engine starts on the first command that needs it; a push that races the subscribing
    /// call waits for it.
    async fn inject(&self, events: Vec<EngineEvent>) -> Result<(), CoreError> {
        for e in events {
            let mut tries = 0;
            while !self.engine.inject(e.clone()) {
                tries += 1;
                if tries > 100 {
                    return Err(CoreError::new(
                        ErrorCode::InvalidInput,
                        "harness.push: no engine is running",
                    ));
                }
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        }
        Ok(())
    }

    /// The world as the core holds it: the real read models for every slice a service owns,
    /// the snapshot's slices, and the last accepted value for everything else.
    async fn world_get(&self) -> Result<Value, CoreError> {
        let mut w = to_json(&*lock(&self.world));
        w["settings"] = self
            .call(WindowLabel::Settings, "settings_get", json!({}))
            .await?;
        w["glossary"] = self
            .call(WindowLabel::Settings, "glossary_list", json!({}))
            .await?;
        w["app"] = self
            .call(WindowLabel::Main, "app_snapshot", json!({}))
            .await?;
        w["app"]["setup"] = self
            .call(WindowLabel::FirstRun, "setup_status", json!({}))
            .await?;
        // The library's read models: what `calls_list` and `call_get` serve over the seeded rows.
        let page = self
            .call(
                WindowLabel::Main,
                "calls_list",
                json!({ "filter": {}, "sort": "newest", "page": { "limit": 500 } }),
            )
            .await?;
        let mut details = vec![];
        for call in page["rows"].as_array().into_iter().flatten() {
            let args = json!({ "call_id": call["id"] });
            details.push(self.call(WindowLabel::Main, "call_get", args).await?);
        }
        w["calls"] = page["rows"].clone();
        w["call_details"] = Value::Array(details);
        // The items service's read model, every page of it.
        let mut items = vec![];
        let mut cursor = Value::Null;
        loop {
            let args = json!({ "filter": {}, "page": { "limit": 500, "cursor": cursor } });
            let page = self.call(WindowLabel::Main, "items_list", args).await?;
            items.extend(page["rows"].as_array().cloned().unwrap_or_default());
            cursor = page["next_cursor"].clone();
            if cursor.is_null() {
                break;
            }
        }
        w["items"] = Value::Array(items);
        w["people"] = self
            .call(WindowLabel::Main, "people_list", json!({}))
            .await?["people"]
            .clone();
        w["topics"] = self
            .call(WindowLabel::Main, "topics_list", json!({}))
            .await?["topics"]
            .clone();
        w["call_types"] = self
            .call(WindowLabel::Main, "call_types_list", json!({}))
            .await?;
        Ok(w)
    }

    /// Applies the slices that changed, or refuses the whole world with `not_implemented`
    /// naming every changed slice no M0 service owns; nothing is applied then.
    async fn world_set(&self, args: Value) -> Result<Value, CoreError> {
        let typed = |v: Value| serde_json::from_value::<FakeWorld>(v);
        let parsed = typed(args.get("world").cloned().unwrap_or(Value::Null)).map_err(|_| {
            CoreError::new(
                ErrorCode::InvalidInput,
                "harness.world_set needs { world: FakeWorld }",
            )
        })?;
        // Both sides through the typed world: f32 fields do not survive a JSON round trip bit
        // for bit, so comparing raw values would see every confidence as changed.
        let wanted = to_json(&parsed);
        let current = to_json(&typed(self.world_get().await?).map_err(crate::internal)?);
        let topics_only = wanted
            .as_object()
            .into_iter()
            .flatten()
            .all(|(key, value)| key == "topics" || current.get(key) == Some(value));
        let mut refused = vec![];
        for (key, value) in wanted.as_object().into_iter().flatten() {
            if current.get(key) == Some(value)
                || matches!(
                    key.as_str(),
                    "now"
                        | "settings"
                        | "app"
                        | "calls"
                        | "call_details"
                        | "transcripts"
                        | "items"
                        | "people"
                        | "outputs"
                        | "today"
                        | "changes"
                        | "topics"
                )
            {
                continue;
            }
            refused.push(key.clone());
        }
        for (key, value) in wanted["app"].as_object().into_iter().flatten() {
            if current["app"].get(key) != Some(value) && !OWNED_APP.contains(&key.as_str()) {
                refused.push(format!("app.{key}"));
            }
        }
        if !refused.is_empty() {
            return Err(CoreError::new(
                ErrorCode::NotImplemented,
                format!(
                    "harness.world_set: no M0 service owns {}",
                    refused.join(", ")
                ),
            ));
        }
        self.write_settings(&wanted["settings"]).await?;
        self.write_setup(&wanted["app"]["setup"]).await?;
        // Compared with the last accepted world: the rows the core serves differ from the
        // fixture in the fields later features own (people, items).
        let accepted = to_json(&*lock(&self.world));
        // A call's folder is the core's own data dir, not the world's to say.
        let sans_folder = |v: &Value| -> Value {
            let mut v = v.clone();
            for d in v.as_array_mut().into_iter().flatten() {
                d["folder"] = Value::Null;
            }
            v
        };
        if !topics_only && accepted["people"] != wanted["people"] {
            self.seed_people(&wanted)?;
        }
        if !topics_only
            && (["calls", "transcripts", "items", "outputs"]
                .iter()
                .any(|k| accepted[k] != wanted[k])
                || sans_folder(&accepted["call_details"]) != sans_folder(&wanted["call_details"]))
        {
            self.clear_calls()?;
            self.seed_calls(&wanted)?;
        }
        if current["topics"] != wanted["topics"] {
            self.replace_topics(&parsed.topics)?;
        }
        if accepted["outputs"] != wanted["outputs"] {
            self.seed_sections(&parsed);
        }
        // The log is append-only: the rows a world adds are written as the core writes them, after
        // the records they name; a row the world drops stays in the log.
        let known: Vec<&Value> = accepted["changes"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| &c["id"])
            .collect();
        let added: Vec<noter_db::Insert> = wanted["changes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|c| !known.contains(&&c["id"]))
            .map(change_row)
            .collect();
        if !added.is_empty() {
            self.core.store().insert_batch(added)?;
        }
        // Today's cards are the core's own over the calendar: only the events are the world's.
        if accepted["today"] != wanted["today"] {
            self.native.set_calendar(&parsed.today);
        }
        // A live call whose hypotheses the world empties waits for speech again: the engine fed
        // the fixture's hypotheses since boot (detection runs it once the self-test passed).
        // Only a change clears: a world that kept no hypotheses leaves pushed ones alone.
        let had_hypotheses = |call: &str| {
            accepted["transcripts"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|t| {
                    t["call_id"] == call
                        && t["hypotheses"].as_array().is_some_and(|h| !h.is_empty())
                })
        };
        for t in parsed.transcripts.iter() {
            if t.hypotheses.is_empty() && had_hypotheses(t.call_id.as_str()) {
                noter_core::testing::clear_hypotheses(&self.core, &t.call_id);
            }
        }
        if current["app"]["setup"]["self_test"] != wanted["app"]["setup"]["self_test"] {
            noter_core::testing::seed_self_test(&self.core, parsed.app.setup.self_test.clone());
        }
        let env = &parsed.app.environment;
        if current["app"]["environment"] != wanted["app"]["environment"]
            || current["app"]["setup"]["permissions"] != wanted["app"]["setup"]["permissions"]
        {
            self.native.set(env, &parsed.app.setup.permissions);
            self.engine
                .set_system_audio(system_audio(&parsed.app.setup.permissions));
            // System audio cannot be queried: the environment row is what the tap was heard to be.
            let heard = env
                .permissions
                .iter()
                .find(|r| r.kind == PermissionKind::SystemAudio)
                .map(|r| r.state)
                .filter(|s| *s != PermissionState::NotAsked);
            noter_core::testing::seed_system_audio(&self.core, heard);
            *lock(&self.updater.ready) = env.update.clone();
            // The Mac says it changed: the core re-reads what was granted outside it.
            self.native.changed();
        }
        // Bundle sizes and progress come from the harness's tiny bundles, not from the preset:
        // only which bundle is in which state is the world's to say.
        let bundle_states = |w: &Value| -> Value {
            w["app"]["setup"]["models"]["bundles"]
                .as_array()
                .map_or(Value::Null, |bs| {
                    bs.iter()
                        .map(|b| json!([b["name"], b["state"], b["required_for_capture"]]))
                        .collect()
                })
        };
        let models_set = bundle_states(&current) != bundle_states(&wanted);
        if models_set {
            self.models
                .place(&self.dir.join("models"), &parsed.app.setup.models)
                .map_err(crate::internal)?;
            self.core.refresh_models();
            // The files say ready or pending; the world's other states live in the core.
            noter_core::testing::seed_models(&self.core, &parsed.app.setup.models);
        }
        if current["app"]["banners"]["banners"] != wanted["app"]["banners"]["banners"] {
            self.core.set_banners(parsed.app.banners.banners.clone());
        }
        let unversioned = |v: &Value| {
            let mut v = v.clone();
            v["version"] = Value::Null;
            v
        };
        if unversioned(&current["app"]["capture"]) != unversioned(&wanted["app"]["capture"]) {
            noter_core::testing::seed_capture(&self.core, parsed.app.capture.clone()).await?;
        }
        if unversioned(&current["app"]["presenting"]) != unversioned(&wanted["app"]["presenting"]) {
            noter_core::testing::seed_presenting(&self.core, parsed.app.presenting.hidden);
        }
        if unversioned(&current["app"]["detection"]) != unversioned(&wanted["app"]["detection"]) {
            noter_core::testing::seed_detection(&self.core, parsed.app.detection.detection.clone());
        }
        if unversioned(&current["app"]["degraded"]) != unversioned(&wanted["app"]["degraded"]) {
            // The setup and hotkey states are the core's own to compute: the world sets the rest.
            let own = |s: &DegradedState| {
                matches!(
                    s,
                    DegradedState::SetupIncomplete | DegradedState::HotkeyNotRegistered { .. }
                )
            };
            let now: Vec<DegradedState> =
                serde_json::from_value(current["app"]["degraded"]["states"].clone())
                    .map_err(crate::internal)?;
            let mut states: Vec<DegradedState> = parsed.app.degraded.states.clone();
            states.retain(|s| !own(s));
            states.extend(now.into_iter().filter(own));
            self.core.set_degraded(states);
        }
        // Derived fields are the core's to compute; a world that disagrees with it is a preset
        // that drifted from the core's rules (what was applied stays applied).
        let after = to_json(&typed(self.world_get().await?).map_err(crate::internal)?);
        let mut drifted: Vec<String> = ["complete", "detection_enabled"]
            .into_iter()
            .filter(|f| after["app"]["setup"][f] != wanted["app"]["setup"][f])
            .map(|f| format!("app.setup.{f}"))
            .collect();
        // The effective privacy follows the degraded set (switched to local).
        if unversioned(&after["app"]["privacy"]) != unversioned(&wanted["app"]["privacy"]) {
            drifted.push("app.privacy".into());
        }
        // Unchanged models are not the world's to enforce: the core moves them itself (a
        // download resumes once the Mac is online again).
        if models_set && bundle_states(&after) != bundle_states(&wanted) {
            drifted.push(format!(
                "app.setup.models (the core has {}, the world says {})",
                bundle_states(&after),
                bundle_states(&wanted)
            ));
        }
        if !drifted.is_empty() {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                format!(
                    "harness.world_set: the core computes {} differently",
                    drifted.join(", ")
                ),
            ));
        }
        *lock(&self.world) = parsed;
        Ok(json!({}))
    }
}

#[derive(serde::Deserialize)]
struct OutputRouteArgs {
    route: OutputRoute,
    output_device: Option<OutputDeviceInfo>,
}

#[derive(serde::Deserialize)]
struct FreeDiskArgs {
    mb: u32,
}

/// The M1 controls on the Mac's side (M1-D3): the core re-reads the reading and sends
/// `env:changed` itself, as it does for a real notification from macOS.
impl Harness {
    fn set_output_route(&self, args: Value) -> Result<Value, CoreError> {
        let a: OutputRouteArgs = parse(
            args,
            "harness.set_output_route needs { route, output_device }",
        )?;
        self.native.update(|r| {
            r.output_route = a.route;
            r.output_device = a.output_device;
        });
        self.core.environment_changed(self.native.environment());
        Ok(json!({}))
    }

    fn set_free_disk(&self, args: Value) -> Result<Value, CoreError> {
        let a: FreeDiskArgs = parse(args, "harness.set_free_disk needs { mb }")?;
        self.native.update(|r| r.disk_free_mb = a.mb);
        self.core.environment_changed(self.native.environment());
        Ok(json!({}))
    }
}

#[derive(serde::Deserialize)]
struct EngineFactArgs {
    event: EngineEvent,
}

/// The engine's side of a scenario: a fact it reports, or its death.
impl Harness {
    /// `delivered` is false while no engine runs (it starts on the first command that needs it).
    fn engine_fact(&self, args: Value) -> Result<Value, CoreError> {
        let a: EngineFactArgs = parse(args, "harness.engine_fact needs { event: EngineEvent }")?;
        Ok(json!({ "delivered": self.engine.inject(a.event) }))
    }

    fn engine_kill(&self) -> Result<Value, CoreError> {
        self.engine.kill_current();
        Ok(json!({}))
    }
}

fn parse<T: serde::de::DeserializeOwned>(args: Value, usage: &str) -> Result<T, CoreError> {
    serde_json::from_value(args).map_err(|_| CoreError::new(ErrorCode::InvalidInput, usage))
}

/// App snapshot slices the harness can set on the M0 core; `window` is the caller's own and the
/// version-only slices follow their owners.
const OWNED_APP: &[&str] = &[
    "setup",
    "environment",
    "banners",
    "window",
    "capture",
    "presenting",
    "degraded",
    "detection",
    "privacy",
];

/// A transcript line as the scripted engine reports it.
fn engine_segment(h: &SegmentView, state: EngineSegmentState) -> EngineSegment {
    EngineSegment {
        id: h.id.as_str().to_string(),
        call_id: h.call_id.clone(),
        channel: h.channel,
        t0_ms: h.t0_ms,
        t1_ms: h.t1_ms,
        state,
        lang: h.lang.clone(),
        lang_p: h.lang_p,
        speaker_label: match &h.speaker.label {
            SpeakerLabel::Person { .. } => h.speaker.speaker_id.to_string(),
            SpeakerLabel::Unnamed { n } => format!("spk_{n}"),
            SpeakerLabel::GuestYourSide => "guest_your_side".into(),
            SpeakerLabel::You => "you".into(),
        },
        text: h.text.clone(),
        words_path: None,
        avg_logprob: 0.0,
        no_speech_p: 0.0,
        corrections: vec![],
        crosstalk_labels: vec![],
    }
}

impl Controls for Harness {
    fn control<'a>(
        &'a self,
        name: &'a str,
        args: Value,
    ) -> BoxFuture<'a, Result<Value, CoreError>> {
        Box::pin(async move {
            match name {
                "world_get" => self.world_get().await,
                "world_set" => self.world_set(args).await,
                "topic_centroids" => self.seed_topic_centroids(args),
                "push" => self.push(args).await,
                // `{}`: the next self-test waits for scenario events instead of its timed script.
                "hold_next_self_test" => {
                    self.engine.hold_next_self_test();
                    Ok(json!({}))
                }
                // `{}`: what the core asked the native layer to show, in order (TL-2).
                "surfaces" => Ok(json!({ "calls": *lock(&self.surfaces.0) })),
                // `{}`: the next model download delivers bytes that fail their checksum.
                "corrupt_next_download" => {
                    self.models.corrupt_next.store(true, Ordering::SeqCst);
                    Ok(json!({}))
                }
                // `{ at_percent: 0..=99 }`: the next bundle fetch stops serving at that fraction
                // until `release_download`, or until the core pauses it.
                "hold_next_download" => {
                    let pct = args["at_percent"]
                        .as_u64()
                        .filter(|p| *p < 100)
                        .ok_or_else(|| {
                            CoreError::new(
                                ErrorCode::InvalidInput,
                                "harness.hold_next_download needs { at_percent: 0..=99 }",
                            )
                        })?;
                    // A release sent before the fetch starts must still count, so the flag is
                    // cleared here, when the hold is set, not when the fetch begins.
                    self.models.released.store(false, Ordering::SeqCst);
                    *lock(&self.models.hold_at) = Some(pct);
                    Ok(json!({}))
                }
                // `{}`: a held download serves the rest.
                "release_download" => {
                    self.models.released.store(true, Ordering::SeqCst);
                    Ok(json!({}))
                }
                // `{}`: the next save panel answers cancelled, once.
                "cancel_next_save_panel" => {
                    self.panel.cancel_next.store(true, Ordering::SeqCst);
                    Ok(json!({}))
                }
                // `{ plan: LaunchPlan, fail?: [{ path, code }] }`: what the Mac reports for the
                // next handoff launches, and which paths fail with which code.
                "launch_world" => {
                    let world: LaunchWorld = parse(
                        args,
                        "harness.launch_world needs { plan: LaunchPlan, fail?: [{ path, code }] }",
                    )?;
                    *lock(&self.panel.launch) = world;
                    Ok(json!({}))
                }
                // `{ fail: ErrorCode | null }`: the Screen Share Test's probe fails with `fail`
                // from now on, or passes again.
                "share_test_probe" => {
                    #[derive(serde::Deserialize)]
                    struct Probe {
                        fail: Option<ErrorCode>,
                    }
                    let probe: Probe = parse(
                        args,
                        "harness.share_test_probe needs { fail: ErrorCode | null }",
                    )?;
                    *lock(&self.panel.probe_fails) = probe.fail;
                    Ok(json!({}))
                }
                // `{}`: the launches and clipboard writes so far, oldest first.
                "native_log" => Ok(lock(&self.panel.log).clone()),
                // `{ op, code }`: fail the next permission request, login-item change or
                // updater installation with a typed host error.
                "native_fail" => {
                    #[derive(serde::Deserialize)]
                    struct Failure {
                        op: String,
                        code: ErrorCode,
                    }
                    let failure: Failure = parse(args, "harness.native_fail needs { op, code }")?;
                    match failure.op.as_str() {
                        "permission_request" if failure.code == ErrorCode::PermissionDenied => {
                            self.native.fail_once(failure.op, failure.code);
                        }
                        "permission_request" => {
                            return Err(CoreError::new(
                                ErrorCode::InvalidInput,
                                "harness.native_fail permission_request only accepts permission_denied",
                            ));
                        }
                        "set_login_item" => {
                            self.native.fail_once(failure.op, failure.code);
                        }
                        "updater_install" => self.updater.fail_once(failure.code),
                        _ => {
                            return Err(CoreError::new(
                                ErrorCode::InvalidInput,
                                "harness.native_fail op must be permission_request, set_login_item or updater_install",
                            ));
                        }
                    }
                    Ok(json!({}))
                }
                // `{ minutes: -840..=840 }`: the Mac's local UTC offset for deterministic text.
                "set_utc_offset" => {
                    let minutes = args["minutes"]
                        .as_i64()
                        .filter(|n| (-840..=840).contains(n))
                        .ok_or_else(|| {
                            CoreError::new(
                                ErrorCode::InvalidInput,
                                "harness.set_utc_offset needs { minutes: -840..=840 }",
                            )
                        })?;
                    self.native.4.store(minutes, Ordering::SeqCst);
                    Ok(json!({}))
                }
                "set_output_route" => self.set_output_route(args),
                "set_free_disk" => self.set_free_disk(args),
                "engine_fact" => self.engine_fact(args),
                "engine_kill" => self.engine_kill(),
                // `{ skill, items?: [{ id, text }] }` → `{ output, runtime, llm_run_id, audit }`: one
                // skill run through the router and the egress gate (TL-13).
                "llm_run" => {
                    let skill = args["skill"].as_str().unwrap_or_default();
                    let items = match args["items"].as_array() {
                        Some(items) => items
                            .iter()
                            .map(|i| (i["id"].as_str(), i["text"].as_str()))
                            .map(|(id, text)| (id.unwrap_or_default(), text.unwrap_or_default()))
                            .map(|(id, text)| (id.to_owned(), text.to_owned()))
                            .collect(),
                        None => vec![("seg_1".into(), "Ann agreed to ship the importer.".into())],
                    };
                    let call_id = args["call_id"].as_str().map(CallId::new);
                    noter_core::testing::llm_run_for(&self.core, skill, items, call_id).await
                }
                // `{ skill, output? | fail?, after_ms?, cost_usd? }`: a `--llm-script` line (`on`
                // named `skill`) that answers the next run of `skill`, once, ahead of the script.
                "llm_next" => {
                    let mut line = args;
                    let skill = line.as_object_mut().and_then(|l| l.remove("skill"));
                    let usage = |e: String| {
                        CoreError::new(
                            ErrorCode::InvalidInput,
                            format!(
                                "harness.llm_next needs {{ skill, output? | fail?, after_ms? }}: {e}"
                            ),
                        )
                    };
                    let skill = skill.ok_or_else(|| usage("no skill".into()))?;
                    line["on"] = skill;
                    self.llm.answer_next(line).map_err(usage)?;
                    Ok(json!({}))
                }
                // `{ on, progress? }`: while on, search and Ask run keyword-only at rebuild
                // `progress` (0 to 1; 0 when unset); off, the indexes are checked and rebuilt as
                // at open, then hybrid.
                "hold_rebuild" => {
                    let on = args["on"].as_bool().ok_or_else(|| {
                        CoreError::new(ErrorCode::InvalidInput, "harness.hold_rebuild needs { on }")
                    })?;
                    let progress = args["progress"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                    noter_core::testing::hold_rebuild(&self.core, on, progress as f32);
                    Ok(json!({}))
                }
                // `{ ms }`: an Ask answer pauses `ms` after each delta and citation (0 = none), so
                // a story can stop it while it arrives.
                "ask_pace" => {
                    let ms = args["ms"].as_u64().ok_or_else(|| {
                        CoreError::new(ErrorCode::InvalidInput, "harness.ask_pace needs { ms }")
                    })?;
                    noter_core::testing::ask_pace(&self.core, ms);
                    Ok(json!({}))
                }
                // `{ tool, installed?, path?, version?, supported?, identity?, login_identity?,
                // install?: { fail?, delay_ms?, version? }, login?: { url?, code?, outcome?,
                // delay_ms?, hold? } }`: replaces what the scripted CLI of `tool` (`claude_code`,
                // `codex`, `ollama`) is, answers and does (TL-32). Unset fields are the defaults:
                // not installed, supported, signed out, installs `1.0.0`, signs in at once.
                "account_cli" => {
                    let script: ToolScript = parse(
                        args,
                        "harness.account_cli needs { tool, installed?, path?, version?, supported?, identity?, login_identity?, install?, login? }",
                    )?;
                    self.account_cli.set(script);
                    Ok(json!({}))
                }
                // `{}` → `{ calls }`: the installs and sign-ins the scripted CLIs ran, oldest
                // first (`install:ClaudeCode`, `login:Claude`).
                "account_cli_log" => Ok(json!({ "calls": self.account_cli.log() })),
                // `{ provider }`: let a held scripted browser sign-in finish.
                "account_cli_release" => {
                    let provider: AccountProvider = parse(
                        args["provider"].clone(),
                        "harness.account_cli_release needs { provider }",
                    )?;
                    self.account_cli.release(provider);
                    Ok(json!({}))
                }
                // `{ call_id?, cloud?, tools }` → `{ run_id, token, socket, config }`: a noter-mcp
                // run registered as the router will, on the core's socket (TL-38).
                "mcp_run" => {
                    let call_id = args["call_id"].as_str().map(CallId::new);
                    let tools = args["tools"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|t| t.as_str().map(str::to_owned))
                        .collect();
                    let cloud = args["cloud"].as_bool() == Some(true);
                    noter_core::testing::mcp_run(&self.core, call_id, cloud, tools).await
                }
                // `{ run_id }` → `{ closed }`: the run's token stops working, its config goes.
                "mcp_close" => {
                    let run_id = args["run_id"].as_str().unwrap_or_default();
                    Ok(json!({ "closed": self.core.close_mcp_run(run_id) }))
                }
                // `{ server, pages?: [{ uri, title, hash?, text, mime? }], listing?: complete |
                // partial | none, oauth?: granted | cancelled | offline, expires_at?, offline? }`:
                // adds or replaces the scripted MCP server `server` (TL-42); tokens it issued stay
                // valid until `expires_at` on the clock.
                "mcp_server" => {
                    #[derive(serde::Deserialize)]
                    struct Server {
                        server: String,
                        #[serde(flatten)]
                        script: ScriptedServer,
                    }
                    let s: Server = parse(
                        args,
                        "harness.mcp_server needs { server, pages?, listing?, oauth?, expires_at?, offline? }",
                    )?;
                    self.mcp.set(&s.server, s.script);
                    Ok(json!({}))
                }
                // `{ ms }` → `{ now }`: the core's clock jumps ahead (a sign-in left past its five
                // minutes); timers stay on real time.
                "advance_clock" => {
                    let ms = args["ms"].as_i64().filter(|ms| *ms >= 0).ok_or_else(|| {
                        CoreError::new(
                            ErrorCode::InvalidInput,
                            "harness.advance_clock needs { ms >= 0 }",
                        )
                    })?;
                    self.skew.fetch_add(ms, Ordering::SeqCst);
                    Ok(json!({ "now": self.clock.now().0 }))
                }
                // `{ locked }`: the Keychain stand-in fails every access while locked.
                "keychain" => {
                    self.secrets
                        .set_locked(args["locked"].as_bool() == Some(true));
                    Ok(json!({}))
                }
                // `{}` → `{ path }`: the data folder of this core, for stories that read its rows and files.
                "data_dir" => Ok(json!({ "path": self.dir.display().to_string() })),
                _ => Err(CoreError::new(
                    ErrorCode::InvalidInput,
                    format!("no control harness.{name}"),
                )),
            }
        })
    }

    // @cpt-state:cpt-noter-state-core-harness-process:p1
    fn shutdown(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            // @cpt-begin:cpt-noter-state-core-harness-process:p1:inst-st-shutdown
            self.core.shutdown().await;
            // @cpt-end:cpt-noter-state-core-harness-process:p1:inst-st-shutdown
            let _ = std::fs::remove_dir_all(&self.dir);
        })
    }
}

/// The fixture world without the rows a fresh install has none of (no `--fixture`).
fn blank(mut w: FakeWorld) -> FakeWorld {
    w.glossary.terms.clear();
    w.app.banners.banners.clear();
    w
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

fn nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos())
}
