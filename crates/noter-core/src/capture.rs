//! The capture session manager (`cpt-noter-feature-core-capture-session`): the one capture
//! machine every surface drives. It guards the start, writes the call row through the change
//! log and marks and gaps as capture data (TL-1), drives the engine session through the
//! supervisor, and publishes `capture:state`. Engine facts arrive on the supervisor's event
//! broadcast; the native layer shows windows through [`Surfaces`] (TL-2).

use std::sync::{Arc, Weak};
use std::time::Duration;

use noter_db::{Insert, Mutation};
use noter_protocol::engine::{AsrBackend, EngineCommand, EngineEvent, GlossaryEntry, StartSession};
use noter_protocol::ipc::{event_names, Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

use crate::app::WholeState;
use crate::notify::Notification;
use crate::{internal, lock, Core};

/// Windows and panels the core asks the native layer for (TL-2). The app implements it over
/// AppKit; the harness records the calls.
pub trait Surfaces: Send + Sync {
    /// The record prompt, shown without taking focus.
    fn show_record_prompt(&self);
    fn close_record_prompt(&self);
    /// The call window on the call display, without taking focus.
    fn open_call_window_inactive(&self);
    /// The call window or the floating panel is on screen.
    fn call_surface_visible(&self) -> bool;
    /// Delivers a notification now (`UNUserNotificationCenter`); when is the core's rule.
    fn post_notification(&self, notification: &Notification);
}

/// No native layer: nothing is shown.
pub(crate) struct NoSurfaces;

impl Surfaces for NoSurfaces {
    fn show_record_prompt(&self) {}
    fn close_record_prompt(&self) {}
    fn open_call_window_inactive(&self) {}
    fn call_surface_visible(&self) -> bool {
        false
    }
    fn post_notification(&self, _: &Notification) {}
}

/// What capture hands the live transcript: marks and gaps as they are stored, and the end of
/// a call's streams.
#[derive(Debug, Clone, PartialEq)]
pub enum CaptureEvent {
    Mark(MarkView),
    Gap(GapView),
    Stopped {
        call_id: CallId,
        reason: StreamEndReason,
    },
}

/// Under this much free disk a start is refused (`disk_full`).
const NEEDED_MB: u32 = 500;
/// Under this much free disk, `DiskLow` warns; it never refuses anything.
const LOW_MB: u32 = 2_048;
/// Continue Recording is offered this long after any stop.
const CONTINUE_MS: i64 = 5 * 60_000;
/// The menu bar's "Paused for 5 minutes" reminder.
const PAUSE_REMIND_MS: i64 = 5 * 60_000;
/// How long a start or a stop waits for the engine's answer before it returns the phase it is in.
const ENGINE_WAIT: Duration = Duration::from_secs(3);
/// The call's title when no calendar event or meeting app names it.
const UNTITLED: &str = "Untitled call";
/// The call type until the post-call pipeline classifies the call (M2).
const UNCLASSIFIED: &str = "unclassified";

/// The session manager's bookkeeping beside the published `CaptureState`; its lock also makes
/// capture commands apply one at a time.
#[derive(Debug, Default)]
pub(crate) struct Session {
    /// Wall time of offset 0: the call's start.
    origin: i64,
    /// Time spent paused, or stopped before Continue; closed spans only.
    pub(crate) away_ms: i64,
    /// When the engine failed and the call stopped recording (Try Again counts the gap from it).
    pub(crate) failed_at: Option<i64>,
    /// When the last stop was asked for, and by whom (its change row names the surface).
    stop: Option<(i64, CommandCtx)>,
    /// The meeting app of the live call (bundle id, name), when a detection started it.
    pub(crate) app: Option<(String, String)>,
    /// Counts the meeting app's audio releases; a call-end timer acts only for the latest.
    pub(crate) released: u64,
    /// When something was last heard (tokio time, for the timer) and at what wall time.
    pub(crate) heard: Option<tokio::time::Instant>,
    pub(crate) heard_since: i64,
    /// Counts nothing-heard timers; only the latest one may raise the notice.
    pub(crate) heard_chain: u64,
    /// The app of the pending new-meeting notice.
    pub(crate) new_meeting: Option<(String, String)>,
    /// Second sources the user kept in this call.
    pub(crate) kept_sources: Vec<String>,
    /// The stop under way was the countdown's, not the user's.
    pub(crate) auto_stop: bool,
    /// Call offset of the engine session's offset 0 (its first `session_started`); the
    /// supervisor's gaps and degraded states count from there.
    pub(crate) engine_base: Option<i64>,
}

/// Where a new call starts: when, under which title, and from which meeting app.
pub(crate) struct Begin {
    pub(crate) at: i64,
    pub(crate) title: Option<String>,
    pub(crate) app: Option<(String, String)>,
}

impl Session {
    /// A fresh session from `origin`; the timer counters go on, so a timer of the last call
    /// never acts for this one.
    pub(crate) fn restart(&self, origin: i64) -> Session {
        Session {
            origin,
            released: self.released,
            heard_chain: self.heard_chain,
            ..Session::default()
        }
    }

    pub(crate) fn offset(&self, at: i64) -> i64 {
        at - self.origin
    }

    /// Wall time of a call offset.
    pub(crate) fn at(&self, offset: i64) -> i64 {
        self.origin + offset
    }

    /// Audio time recorded at `at`: the call so far, minus pauses (an open one too) and stops.
    pub(crate) fn recorded(&self, at: i64, pause: Option<&PauseInfo>) -> DurationMs {
        let open = pause.map_or(0, |p| at - p.since.0);
        DurationMs(ms(at - self.origin - self.away_ms - open))
    }
}

impl WholeState for CaptureState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

/// Milliseconds as the protocol carries them (u32: 49 days).
fn ms(v: i64) -> u32 {
    v.clamp(0, u32::MAX.into()) as u32
}

// @cpt-state:cpt-noter-state-core-capture-session-phase:p1
/// The idle state: no call.
pub(crate) fn to_idle(c: &mut CaptureState) {
    c.phase = CapturePhase::Idle;
    c.call_id = None;
    c.title = None;
    c.started_at = None;
    c.recorded_ms = DurationMs(0);
    c.sensitive = false;
    c.pause = None;
    c.notice = None;
    c.continue_until = None;
    c.audio_not_stored = false;
    c.audio_writing = false;
}

pub(crate) fn live(state: &CaptureState, call_id: &CallId) -> bool {
    matches!(state.phase, CapturePhase::Recording | CapturePhase::Paused)
        && state.call_id.as_ref() == Some(call_id)
}

fn backend(choice: TranscriptionBackend) -> AsrBackend {
    match choice {
        TranscriptionBackend::WhisperTurboNoterLoop | TranscriptionBackend::WhisperProStreaming => {
            AsrBackend::WhisperTurbo
        }
        TranscriptionBackend::ParakeetTdtV3 => AsrBackend::ParakeetTdtV3,
        TranscriptionBackend::WhisperLargeV3 => AsrBackend::WhisperLargeV3,
    }
}

fn mode_used(mode: PrivacyMode, sensitive: bool) -> &'static str {
    match (sensitive, mode) {
        (true, _) => "sensitive_local",
        (false, PrivacyMode::CloudAllowed) => "cloud",
        (false, PrivacyMode::CloudRedacted) => "cloud_redacted",
        (false, PrivacyMode::LocalOnly) => "local_only",
    }
}

pub(crate) fn not_recording() -> CoreError {
    CoreError::new(ErrorCode::NotRecording, "no live call with this id")
}

/// The glossary as the engine takes it.
fn entries(list: &GlossaryList) -> Vec<GlossaryEntry> {
    list.terms
        .iter()
        .map(|t| GlossaryEntry {
            term: t.term.clone(),
            variants_latin: t.variants_latin.clone(),
            variants_cyrillic: t.variants_cyrillic.clone(),
            spoken_forms: t.spoken_forms.clone(),
        })
        .collect()
}

impl Core {
    /// Starts listening to the engine for the capture machine and hands glossary edits to a
    /// live call. Runs from `start_first_run`, once per core.
    pub(crate) fn start_capture(self: &Arc<Self>) {
        let weak: Weak<Core> = Arc::downgrade(self);
        let mut events = self.engine.events();
        self.spawn(async move {
            loop {
                match events.recv().await {
                    Ok(line) => match weak.upgrade() {
                        Some(core) => core.engine_fact(line.event).await,
                        None => return,
                    },
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return,
                }
            }
        });
        let weak: Weak<Core> = Arc::downgrade(self);
        let mut facts = self.engine.capture_facts();
        self.spawn(async move {
            loop {
                match facts.recv().await {
                    Ok(fact) => match weak.upgrade() {
                        Some(core) => core.capture_fact(fact).await,
                        None => return,
                    },
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return,
                }
            }
        });
        // Setup done and the self-test passed before this launch: detection is on, so the
        // engine starts to hear calls.
        let on = {
            let fr = lock(&self.first_run);
            crate::first_run::detection(fr.offer_to_record, &fr.stored.self_test).0
        };
        if on {
            let core = self.clone();
            self.spawn(async move { core.send_detection(true).await });
        }
        if let Err(e) = self.find_interrupted() {
            self.log(crate::object(json!({
                "level": "error", "module": "capture", "code": e.code
            })));
        }
        let weak = Arc::downgrade(self);
        self.on_glossary_changed(move |list| {
            let Some(core) = weak.upgrade() else { return };
            // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-live-glossary
            let phase = core.capture_now().phase;
            if matches!(phase, CapturePhase::Recording | CapturePhase::Paused) {
                let set = EngineCommand::SetGlossary {
                    entries: entries(list),
                };
                let engine = core.engine.clone();
                core.spawn(async move {
                    let _ = engine.command(set).await;
                });
            }
            // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-live-glossary
        });
    }

    /// Hears marks, gaps and stream ends as capture stores them (the live transcript).
    pub fn on_capture_event(&self, hook: impl Fn(&CaptureEvent) + Send + Sync + 'static) {
        lock(&self.capture_hooks).push(Box::new(hook));
    }

    fn capture_event(&self, event: CaptureEvent) {
        for hook in lock(&self.capture_hooks).iter() {
            hook(&event);
        }
    }

    pub(crate) fn capture_now(&self) -> CaptureState {
        self.app().capture.clone()
    }

    /// Changes the capture state and sends it whole with the next version.
    pub(crate) fn set_capture(&self, change: impl FnOnce(&mut CaptureState)) -> CaptureState {
        let mut app = self.app();
        change(&mut app.capture);
        let state = self.publish(event_names::CAPTURE_STATE, &mut app.capture);
        self.capture_phase.send_replace(state.phase);
        state
    }

    /// Waits until the phase is no longer `from`, at most [`ENGINE_WAIT`].
    async fn phase_leaves(&self, from: CapturePhase) -> CaptureState {
        let mut phase = self.capture_phase.subscribe();
        let _ = tokio::time::timeout(ENGINE_WAIT, phase.wait_for(|p| *p != from)).await;
        self.capture_now()
    }

    // @cpt-algo:cpt-noter-algo-core-capture-session-start-guard:p1
    pub(crate) fn start_guard(&self, phase: CapturePhase) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-recording
        if !matches!(phase, CapturePhase::Idle | CapturePhase::Stopped) {
            return Err(CoreError::new(
                ErrorCode::AlreadyRecording,
                "a capture is running",
            ));
        }
        // @cpt-end:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-recording
        // @cpt-begin:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-disk
        let free_mb = self.app().environment.disk_free_mb;
        if free_mb < NEEDED_MB {
            return Err(
                CoreError::new(ErrorCode::DiskFull, "not enough free disk to record").with_detail(
                    ErrorDetail::DiskSpace {
                        free_mb,
                        needed_mb: NEEDED_MB,
                    },
                ),
            );
        }
        // @cpt-end:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-disk
        // @cpt-begin:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-model
        if !lock(&self.downloads).capture_ready() {
            return Err(CoreError::new(
                ErrorCode::ModelMissing,
                "the live model is not downloaded",
            ));
        }
        // @cpt-end:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-model
        // @cpt-begin:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-ok
        Ok(())
        // @cpt-end:cpt-noter-algo-core-capture-session-start-guard:p1:inst-guard-ok
    }

    /// Columns of the `calls` row, through the change log. Capture moves are not undoable.
    pub(crate) fn write_call(
        &self,
        ctx: &CommandCtx,
        call_id: &CallId,
        summary: &str,
        undoable: bool,
        values: Vec<(&'static str, Value)>,
    ) -> Result<(), CoreError> {
        let mut meta = self.change_meta(ctx, summary.into(), summary);
        meta.undoable = undoable;
        let mutation = Mutation {
            entity_type: "call",
            table: "calls",
            id: call_id.as_str().into(),
            base_rev: None,
            bump_rev: true,
            values,
        };
        self.store().write(mutation, meta).map(drop)
    }

    // @cpt-algo:cpt-noter-algo-core-capture-session-degraded:p1
    pub(crate) fn insert_gap(
        &self,
        call_id: &CallId,
        t0: i64,
        t1: i64,
        reason: GapReason,
    ) -> Result<(), CoreError> {
        // A gap of no length loses nothing, and would take the next gap's key.
        if t1 <= t0 {
            return Ok(());
        }
        self.store().insert_batch(vec![Insert {
            table: "gaps",
            values: vec![
                ("call_id", json!(call_id.as_str())),
                ("t0_ms", json!(t0)),
                ("t1_ms", json!(t1)),
                ("reason", serde_json::to_value(reason).map_err(internal)?),
            ],
        }])?;
        self.capture_event(CaptureEvent::Gap(GapView {
            call_id: call_id.clone(),
            t0_ms: OffsetMs(ms(t0)),
            t1_ms: OffsetMs(ms(t1)),
            reason,
        }));
        Ok(())
    }

    /// The engine session for `call_id`; `resume_from_ms` continues its offsets.
    pub(crate) fn session_for(
        &self,
        call_id: &CallId,
        resume_from_ms: Option<i64>,
    ) -> Result<StartSession, CoreError> {
        let audio = lock(&self.settings).audio.clone();
        Ok(StartSession {
            call_id: call_id.clone(),
            session_dir: format!("audio/{call_id}/"),
            store_audio: audio.retention != AudioRetention::NeverStore,
            mic_device_uid: audio.mic_device,
            exclude_bundle_ids: vec![],
            languages: vec![],
            backend: backend(audio.live_backend),
            glossary: entries(&self.glossary()?),
            speaker_priors: vec![],
            enrolled_embeddings_path: None,
            resume_from_ms: resume_from_ms.map(|at| OffsetMs(ms(at))),
        })
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-start:p1
    // @cpt-dod:cpt-noter-dod-core-capture-session-native-callers:p1
    pub(crate) async fn start_call(
        &self,
        ctx: &CommandCtx,
        args: CaptureStartArgs,
    ) -> Result<CaptureState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-start-call
        let now = self.deps.clock.now().0;
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-start-from-prompt
        let detection = self.take_detection(&args, now)?;
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-start-from-prompt
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-start-call
        let begin = Begin {
            at: now,
            title: detection.as_ref().map(|d| {
                d.matched_event
                    .as_ref()
                    .map_or_else(|| d.app_name.clone(), |e| e.title.clone())
            }),
            app: detection
                .as_ref()
                .map(|d| (d.bundle_id.clone(), d.app_name.clone())),
        };
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-run-start
        let started = self.begin_call(ctx, args.sensitive, begin).await?;
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-run-start
        if detection.is_some() {
            self.set_detection(None);
            self.deps.surfaces.close_record_prompt();
        }
        Ok(started)
    }

    /// A new call from `begin`, through the start guard.
    pub(crate) async fn begin_call(
        &self,
        ctx: &CommandCtx,
        sensitive: bool,
        begin: Begin,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let now = begin.at;
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-start-guard
        self.start_guard(self.capture_now().phase)?;
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-start-guard
        // Another capture ends the call a quit cut, and its Resume Recording offer.
        self.drop_interrupted()?;
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-close-continue
        // A stopped call's Continue window closes: the new call replaces it.
        *session = Session {
            app: begin.app.clone(),
            ..session.restart(now)
        };
        let title = begin.title.unwrap_or_else(|| UNTITLED.into());
        let platform = begin.app.map(|(_, name)| name);
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-close-continue
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-insert-call
        let call_id = CallId::new(format!("call_{}", ulid::Ulid::generate()));
        let start = self.session_for(&call_id, None)?;
        let store_audio = start.store_audio;
        let privacy = lock(&self.settings).privacy.mode;
        let class = if sensitive { "sensitive" } else { "normal" };
        self.write_call(
            ctx,
            &call_id,
            "Started recording",
            false,
            vec![
                ("started_at", json!(now)),
                ("title", json!(title)),
                ("platform", json!(platform)),
                ("call_type", json!(UNCLASSIFIED)),
                ("status", json!("recording")),
                ("privacy_class", json!(class)),
                ("audio_not_stored", json!(!store_audio)),
                ("mode_used", json!(mode_used(privacy, sensitive))),
            ],
        )?;
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-insert-call
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-phase-starting
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-start
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-start-from-stopped
        self.set_capture(|c| {
            *c = CaptureState {
                version: c.version,
                phase: CapturePhase::Starting,
                call_id: Some(call_id.clone()),
                title: Some(title),
                started_at: Some(TimestampMs(now)),
                recorded_ms: DurationMs(0),
                sensitive,
                pause: None,
                notice: None,
                continue_until: None,
                output_route: c.output_route,
                replay_available: c.replay_available,
                audio_not_stored: !store_audio,
                audio_writing: store_audio,
            }
        });
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-start-from-stopped
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-start
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-phase-starting
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-start-engine
        session.engine_base = None;
        if self.engine.start_session(start).await.is_err() {
            // Never refused (O1): the call stays; Stop ends it, Try Again restarts the engine.
            session.failed_at = Some(now);
            return Ok(self.set_capture(|c| c.phase = CapturePhase::Failed));
        }
        drop(session);
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-start-engine
        // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-return-started
        Ok(self.phase_leaves(CapturePhase::Starting).await)
        // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-return-started
    }

    /// An engine fact for the capture machine.
    async fn engine_fact(&self, event: EngineEvent) {
        match event {
            EngineEvent::SessionStarted { call_id, .. } => {
                let mut session = self.capture.lock().await;
                let state = self.capture_now();
                if state.call_id.as_ref() == Some(&call_id) && session.engine_base.is_none() {
                    session.engine_base = Some(session.offset(self.deps.clock.now().0));
                }
                // @cpt-begin:cpt-noter-flow-core-capture-session-start:p1:inst-phase-recording
                // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-recording
                if state.phase == CapturePhase::Starting && state.call_id == Some(call_id) {
                    self.set_capture(|c| c.phase = CapturePhase::Recording);
                    self.deps.surfaces.open_call_window_inactive();
                    self.listen_for_speech(&mut session);
                }
                // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-recording
                // @cpt-end:cpt-noter-flow-core-capture-session-start:p1:inst-phase-recording
            }
            EngineEvent::SessionStopped { call_id, .. } => {
                let mut session = self.capture.lock().await;
                if let Err(e) = self.finish_stop(&mut session, &call_id) {
                    self.log(crate::object(json!({
                        "level": "error", "module": "capture", "code": e.code
                    })));
                }
            }
            EngineEvent::CallDetected {
                bundle_id,
                app_name,
                ..
            } => self.call_detected(bundle_id, app_name).await,
            EngineEvent::CallAudioReleased { bundle_id } => self.audio_released(bundle_id).await,
            EngineEvent::AudioSourceAdded {
                call_id,
                bundle_id,
                app_name,
            } => self.source_added(call_id, bundle_id, app_name).await,
            EngineEvent::Segment { segment } => self.heard(&segment.call_id).await,
            _ => {}
        }
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-pause-mark:p1
    pub(crate) async fn pause_call(
        &self,
        ctx: &CommandCtx,
        args: CapturePauseArgs,
    ) -> Result<CaptureState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-pause-call
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let now = self.deps.clock.now().0;
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-pause-call
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-if-not-live
        if !live(&state, &args.call_id) {
            return Err(not_recording());
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-if-not-live
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-if-same
        if args.paused == (state.phase == CapturePhase::Paused) {
            return Ok(state);
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-if-same
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-apply-pause
        let call_id = args.call_id;
        if args.paused {
            let _ = self.engine.pause_session().await;
            let status = vec![("status", json!("paused"))];
            self.write_call(ctx, &call_id, "Paused recording", false, status)?;
            let pause = PauseInfo {
                since: TimestampMs(now),
                remind_at: Some(TimestampMs(now + PAUSE_REMIND_MS)),
            };
            let recorded = session.recorded(now, Some(&pause));
            // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-pause
            return Ok(self.set_capture(|c| {
                c.phase = CapturePhase::Paused;
                c.pause = Some(pause);
                c.recorded_ms = recorded;
            }));
            // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-pause
        }
        let _ = self.engine.resume_session().await;
        let since = state.pause.map_or(now, |p| p.since.0);
        let (t0, t1) = (session.offset(since), session.offset(now));
        self.insert_gap(&call_id, t0, t1, GapReason::Paused)?;
        session.away_ms += now - since;
        let status = vec![("status", json!("recording"))];
        self.write_call(ctx, &call_id, "Resumed recording", false, status)?;
        let recorded = session.recorded(now, None);
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-apply-pause
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-return-pause
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-resume
        Ok(self.set_capture(|c| {
            c.phase = CapturePhase::Recording;
            c.pause = None;
            c.recorded_ms = recorded;
        }))
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-resume
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-return-pause
    }

    pub(crate) async fn mark_moment(&self, args: MarkMomentArgs) -> Result<MarkView, CoreError> {
        let session = self.capture.lock().await;
        if !live(&self.capture_now(), &args.call_id) {
            return Err(not_recording());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-insert-mark
        let mark = MarkView {
            id: MarkId::new(format!("mrk_{}", ulid::Ulid::generate())),
            call_id: args.call_id,
            at_ms: OffsetMs(ms(session.offset(self.deps.clock.now().0))),
            note: args.note,
        };
        self.store().insert_batch(vec![Insert {
            table: "marks",
            values: vec![
                ("id", json!(mark.id.as_str())),
                ("call_id", json!(mark.call_id.as_str())),
                ("at_ms", json!(mark.at_ms.0)),
                ("note", json!(mark.note)),
            ],
        }])?;
        self.capture_event(CaptureEvent::Mark(mark.clone()));
        // @cpt-end:cpt-noter-flow-core-capture-session-pause-mark:p1:inst-insert-mark
        Ok(mark)
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-stop:p1
    pub(crate) async fn stop_call(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.stop_call_at(ctx, args, None).await
    }

    /// Stops the call; it ends at `ended` (the new meeting's start) or now.
    pub(crate) async fn stop_call_at(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
        ended: Option<i64>,
    ) -> Result<CaptureState, CoreError> {
        let session = self.capture.lock().await;
        self.stop_locked(session, ctx, args, ended).await
    }

    /// The stop, from a caller that already holds the capture lock (and checked under it).
    pub(crate) async fn stop_locked(
        &self,
        mut session: tokio::sync::MutexGuard<'_, Session>,
        ctx: &CommandCtx,
        args: CallIdArgs,
        ended: Option<i64>,
    ) -> Result<CaptureState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-stop-call
        let state = self.capture_now();
        let now = self.deps.clock.now().0;
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-stop-call
        if state.call_id.as_ref() != Some(&args.call_id) || state.phase == CapturePhase::Idle {
            return Err(not_recording());
        }
        if matches!(state.phase, CapturePhase::Stopped | CapturePhase::Stopping) {
            return Ok(state);
        }
        if let Some(pause) = &state.pause {
            let (t0, t1) = (session.offset(pause.since.0), session.offset(now));
            self.insert_gap(&args.call_id, t0, t1, GapReason::Paused)?;
            session.away_ms += now - pause.since.0;
        }
        session.stop = Some((ended.unwrap_or(now), ctx.clone()));
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-stopping
        let recorded = session.recorded(now, None);
        self.set_capture(|c| {
            c.phase = CapturePhase::Stopping;
            c.pause = None;
            c.recorded_ms = recorded;
        });
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-stopping
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-engine-stop
        // A failed engine runs no session: the call ends at the last audio at once.
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-failed-stop
        if state.phase != CapturePhase::Failed {
            drop(session);
            if self.engine.stop_session().await.is_ok() {
                self.phase_leaves(CapturePhase::Stopping).await;
            }
            session = self.capture.lock().await;
        }
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-failed-stop
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-engine-stop
        // Without the engine's answer in time the call still ends, at the stop.
        self.finish_stop(&mut session, &args.call_id)?;
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-return-stop
        Ok(self.capture_now())
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-return-stop
    }

    /// The stop's second half, once: the call row, phase `stopped`, the Continue window and
    /// the post-call hand-off. Nothing happens unless `call_id` is stopping.
    fn finish_stop(&self, session: &mut Session, call_id: &CallId) -> Result<(), CoreError> {
        let state = self.capture_now();
        if state.phase != CapturePhase::Stopping || state.call_id.as_ref() != Some(call_id) {
            return Ok(());
        }
        let (ended, ctx) = session.stop.clone().unwrap_or_else(|| {
            let main = Caller::Window {
                label: WindowLabel::Main,
            };
            (self.deps.clock.now().0, CommandCtx { caller: main })
        });
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-update-call
        let values = vec![("status", json!("processing")), ("ended_at", json!(ended))];
        self.write_call(&ctx, call_id, "Stopped recording", false, values)?;
        self.capture_event(CaptureEvent::Stopped {
            call_id: call_id.clone(),
            reason: StreamEndReason::CallStopped,
        });
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-update-call
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-phase-stopped
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-stopped
        let until = TimestampMs(self.deps.clock.now().0 + CONTINUE_MS);
        let recorded = session.recorded(ended, None);
        let notice =
            std::mem::take(&mut session.auto_stop).then(|| CaptureNotice::StoppedAutomatically {
                call_id: call_id.clone(),
            });
        self.set_capture(|c| {
            c.phase = CapturePhase::Stopped;
            c.pause = None;
            c.recorded_ms = recorded;
            c.continue_until = Some(until);
            c.notice = notice;
        });
        self.drop_sources_of(call_id);
        self.clear_engine_states();
        self.release_held();
        self.close_continue_at(call_id.clone(), until, CONTINUE_MS);
        // The post-call hand-off is a no-op until the PostCall job (M2).
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-stopped
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-phase-stopped
        Ok(())
    }

    pub(crate) async fn continue_call(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let now = self.deps.clock.now().0;
        let open = state.phase == CapturePhase::Stopped
            && state.call_id.as_ref() == Some(&args.call_id)
            && state.continue_until.is_some_and(|until| now <= until.0);
        if !open {
            return Err(CoreError::new(
                ErrorCode::ContinueWindowClosed,
                "Continue Recording is no longer offered",
            ));
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-continue
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-continue
        let call_id = args.call_id;
        let stopped_at = session.stop.take().map_or(now, |(at, _)| at);
        let (t0, t1) = (session.offset(stopped_at), session.offset(now));
        self.insert_gap(&call_id, t0, t1, GapReason::Continued)?;
        session.away_ms += now - stopped_at;
        let values = vec![("status", json!("recording")), ("ended_at", Value::Null)];
        self.write_call(ctx, &call_id, "Continued recording", false, values)?;
        let start = self.session_for(&call_id, Some(t1))?;
        let recorded = session.recorded(now, None);
        self.set_capture(|c| {
            c.phase = CapturePhase::Recording;
            c.continue_until = None;
            c.notice = None;
            c.recorded_ms = recorded;
        });
        self.listen_for_speech(&mut session);
        session.engine_base = None;
        if self.engine.start_session(start).await.is_err() {
            session.failed_at = Some(now);
            return Ok(self.set_capture(|c| c.phase = CapturePhase::Failed));
        }
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-continue
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-continue
        Ok(self.capture_now())
    }

    pub(crate) async fn discard_call(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let heard_nothing = matches!(state.notice, Some(CaptureNotice::NothingHeard { .. }));
        if !(live(&state, &args.call_id) && heard_nothing) {
            return Err(CoreError::new(
                ErrorCode::NoticeExpired,
                "the nothing-heard notice is not shown",
            ));
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-stop:p1:inst-discard
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-discard
        let call_id = args.call_id;
        self.set_capture(|c| c.phase = CapturePhase::Stopping);
        let _ = self.engine.stop_session().await;
        let meta = self.change_meta(ctx, "Discarded recording".into(), "capture_discard");
        let id = call_id.as_str().to_string();
        self.store().delete("call", "calls", vec![id], meta)?;
        if let Err(e) = std::fs::remove_dir_all(self.audio_dir.join(call_id.as_str())) {
            if e.kind() != std::io::ErrorKind::NotFound {
                self.log(crate::object(json!({
                    "level": "warn", "module": "capture", "message": "discarded audio stays"
                })));
            }
        }
        self.capture_event(CaptureEvent::Stopped {
            call_id: call_id.clone(),
            reason: StreamEndReason::Discarded,
        });
        self.drop_sources_of(&call_id);
        self.clear_engine_states();
        *session = session.restart(0);
        let idle = self.set_capture(to_idle);
        self.release_held();
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-discard
        // @cpt-end:cpt-noter-flow-core-capture-session-stop:p1:inst-discard
        Ok(idle)
    }

    /// The capture state as `harness.world_set` asks: the call row it names exists and the
    /// machine continues from there (harness only).
    pub(crate) async fn seed_capture(&self, wanted: CaptureState) -> Result<(), CoreError> {
        let mut session = self.capture.lock().await;
        let now = self.deps.clock.now().0;
        *session = session.restart(now - i64::from(wanted.recorded_ms.0));
        if let Some(call_id) = wanted
            .call_id
            .as_ref()
            .filter(|_| wanted.phase != CapturePhase::Idle)
        {
            let id = call_id.as_str().to_string();
            let found: i64 = self.store().read(move |c| {
                c.query_row("SELECT count(*) FROM calls WHERE id = ?1", [id], |r| {
                    r.get(0)
                })
            })?;
            if found == 0 {
                let status = match wanted.phase {
                    CapturePhase::Paused => "paused",
                    CapturePhase::Stopping | CapturePhase::Stopped => "processing",
                    _ => "recording",
                };
                let privacy = lock(&self.settings).privacy.mode;
                let class = if wanted.sensitive {
                    "sensitive"
                } else {
                    "normal"
                };
                let main = CommandCtx {
                    caller: Caller::Window {
                        label: WindowLabel::Main,
                    },
                };
                let values = vec![
                    ("started_at", json!(wanted.started_at.map_or(now, |t| t.0))),
                    ("title", json!(wanted.title.as_deref().unwrap_or(UNTITLED))),
                    ("call_type", json!(UNCLASSIFIED)),
                    ("status", json!(status)),
                    ("privacy_class", json!(class)),
                    ("audio_not_stored", json!(wanted.audio_not_stored)),
                    ("mode_used", json!(mode_used(privacy, wanted.sensitive))),
                ];
                self.write_call(&main, call_id, "Seeded call", false, values)?;
            }
        }
        self.set_capture(|c| {
            *c = CaptureState {
                version: c.version,
                ..wanted
            }
        });
        Ok(())
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-sensitive:p2
    pub(crate) async fn set_call_sensitive(
        &self,
        ctx: &CommandCtx,
        args: SensitiveArgs,
    ) -> Result<CaptureState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-sensitive:p2:inst-sensitive-call
        let _session = self.capture.lock().await;
        let state = self.capture_now();
        let current = state.call_id.as_ref() == Some(&args.call_id);
        let running = current && !matches!(state.phase, CapturePhase::Idle | CapturePhase::Stopped);
        // @cpt-end:cpt-noter-flow-core-capture-session-sensitive:p2:inst-sensitive-call
        // @cpt-begin:cpt-noter-flow-core-capture-session-sensitive:p2:inst-if-off-live
        if running && !args.sensitive {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "a call cannot stop being sensitive while it records",
            ));
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-sensitive:p2:inst-if-off-live
        let id = args.call_id.as_str().to_string();
        let found: i64 = self.store().read(move |c| {
            c.query_row("SELECT count(*) FROM calls WHERE id = ?1", [id], |r| {
                r.get(0)
            })
        })?;
        if found == 0 {
            return Err(CoreError::new(ErrorCode::NotFound, "no such call"));
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-sensitive:p2:inst-write-sensitive
        let class = if args.sensitive {
            "sensitive"
        } else {
            "normal"
        };
        let values = vec![("privacy_class", json!(class))];
        self.write_call(ctx, &args.call_id, "Changed sensitivity", !running, values)?;
        // @cpt-end:cpt-noter-flow-core-capture-session-sensitive:p2:inst-write-sensitive
        if !current || state.sensitive == args.sensitive {
            return Ok(state);
        }
        Ok(self.set_capture(|c| c.sensitive = args.sensitive))
    }

    /// A new disk reading: `DiskLow` under 2 GB, `DiskFull` under 500 MB, when a call stops
    /// writing audio while the transcript goes on.
    pub(crate) fn disk_changed(&self, free_mb: u32) {
        // @cpt-begin:cpt-noter-algo-core-capture-session-degraded:p1:inst-disk
        self.edit_degraded(|states| {
            states.retain(|s| {
                !matches!(
                    s,
                    DegradedState::DiskLow { .. } | DegradedState::DiskFull { .. }
                )
            });
            if free_mb < NEEDED_MB {
                states.push(DegradedState::DiskFull { free_mb });
            } else if free_mb < LOW_MB {
                states.push(DegradedState::DiskLow { free_mb });
            }
        });
        let state = self.capture_now();
        let writing = !state.audio_not_stored && free_mb >= NEEDED_MB;
        let running = !matches!(state.phase, CapturePhase::Idle | CapturePhase::Stopped);
        if running && state.audio_writing != writing {
            self.set_capture(|c| c.audio_writing = writing);
        }
        // @cpt-end:cpt-noter-algo-core-capture-session-degraded:p1:inst-disk
    }
}
