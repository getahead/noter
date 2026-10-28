//! Call detection, the record prompt and the capture notices with their timers
//! (`cpt-noter-algo-core-capture-session-detection`, `-notice-timers`). Timers run on tokio
//! time (TL-4); each one re-checks on waking that the state it was set for is still there,
//! so nothing has to cancel them. Timestamps come from the core's clock.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use noter_protocol::engine::EngineCommand;
use noter_protocol::ipc::{event_names, Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;

use crate::app::WholeState;
use crate::capture::{live, not_recording, Begin};
use crate::{first_run, lock, Core};

/// Meeting apps that count when they play audio while the microphone is in use (D-24).
pub(crate) const MEETING_APPS: &[&str] = &[
    "us.zoom.xos",
    "com.microsoft.teams2",
    "com.microsoft.teams",
    "com.cisco.webexmeetingsapp",
    "Cisco-Systems.Spark",
    "com.tinyspeck.slackmacgap",
    "com.hnc.Discord",
    "com.apple.FaceTime",
];

/// Browsers that count only when they play audio and hold the microphone themselves (D-24).
pub(crate) const BROWSERS: &[&str] = &[
    "com.apple.Safari",
    "com.google.Chrome",
    "org.chromium.Chromium",
    "com.microsoft.edgemac",
    "org.mozilla.firefox",
    "company.thebrowser.Browser",
    "com.brave.Browser",
    "com.operasoftware.Opera",
    "com.vivaldi.Vivaldi",
];

const PROMPT_MS: i64 = 15_000;
/// The meeting app let go of audio and microphone this long before the call-ended notice.
const RELEASED_MS: i64 = 20_000;
const COUNTDOWN_MS: i64 = 10_000;
/// While hidden for presenting, the call "seems ended" this long before it stops.
const SEEMS_ENDED_MS: i64 = 10 * 60_000;
const NOTHING_HEARD_MS: i64 = 5 * 60_000;
const NEW_MEETING_MS: i64 = 60_000;

/// Both lists minus the ignored apps.
/// shortcut: one wire list, so the engine applies the browser rule (plays audio and holds the
/// mic itself) to meeting apps too; split `SetDetection` when the Swift detection slice lands.
pub(crate) fn known_apps(ignored: &[IgnoredApp]) -> Vec<String> {
    MEETING_APPS
        .iter()
        .chain(BROWSERS)
        .filter(|b| !ignored.iter().any(|a| a.bundle_id == **b))
        .map(|b| b.to_string())
        .collect()
}

fn notice_expired() -> CoreError {
    CoreError::new(ErrorCode::NoticeExpired, "the notice is gone")
}

fn detection_expired() -> CoreError {
    CoreError::new(ErrorCode::DetectionExpired, "the detection is gone")
}

/// A timer's own caller: the user, from no window.
fn timer_ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

impl WholeState for DetectionChanged {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

impl Core {
    /// Runs `work` after `ms` of tokio time, if the core still exists.
    pub(crate) fn after<F, Fut>(&self, ms: i64, work: F)
    where
        F: FnOnce(Arc<Core>) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let Some(core) = self.this() else { return };
        let weak = Arc::downgrade(&core);
        drop(core);
        // The deadline counts from now, not from when the task first runs.
        let due = tokio::time::Instant::now() + Duration::from_millis(ms.max(0) as u64);
        self.spawn(async move {
            tokio::time::sleep_until(due).await;
            if let Some(core) = weak.upgrade() {
                work(core).await;
            }
        });
    }

    pub(crate) fn detection_now(&self) -> Option<CallDetection> {
        self.app().detection.detection.clone()
    }

    pub(crate) fn set_detection(&self, detection: Option<CallDetection>) {
        let mut app = self.app();
        app.detection.detection = detection;
        self.publish(event_names::CAPTURE_DETECTED, &mut app.detection);
    }

    /// The detection as `harness.world_set` seeds it (feature `harness`).
    #[cfg(feature = "harness")]
    pub(crate) fn seed_detection(&self, detection: Option<CallDetection>) {
        let shown = detection.is_some();
        self.set_detection(detection);
        if shown && !self.app().presenting.hidden {
            self.deps.surfaces.show_record_prompt();
        } else {
            self.deps.surfaces.close_record_prompt();
        }
    }

    fn set_notice(&self, notice: Option<CaptureNotice>) -> CaptureState {
        // @cpt-begin:cpt-noter-flow-core-capture-session-notices:p1:inst-raise-notice
        // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-return
        self.set_capture(|c| c.notice = notice)
        // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-return
        // @cpt-end:cpt-noter-flow-core-capture-session-notices:p1:inst-raise-notice
    }

    /// The engine reported a meeting app holding audio.
    // @cpt-flow:cpt-noter-flow-core-capture-session-record-detected:p1
    // @cpt-dod:cpt-noter-dod-core-capture-session-detection:p1
    pub(crate) async fn call_detected(&self, bundle_id: String, app_name: String) {
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-detected-fact
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let now = self.deps.clock.now().0;
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-detected-fact
        if matches!(state.phase, CapturePhase::Recording | CapturePhase::Paused) {
            let same_app = session.app.as_ref().is_some_and(|(b, _)| *b == bundle_id);
            let asked = matches!(state.notice, Some(CaptureNotice::NewMeeting { .. }));
            if !same_app && !asked {
                // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-new-meeting
                let notice = CaptureNotice::NewMeeting {
                    event: None,
                    app_name: Some(app_name.clone()),
                    detected_at: TimestampMs(now),
                    expires_at: TimestampMs(now + NEW_MEETING_MS),
                    default_choice: NewMeetingChoice::StartAsNewCall,
                };
                session.new_meeting = Some((bundle_id, app_name));
                self.set_notice(Some(notice.clone()));
                self.after(NEW_MEETING_MS, move |core| async move {
                    if core.capture_now().notice == Some(notice) {
                        let _ = core.split_call(&timer_ctx()).await;
                    }
                });
                // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-new-meeting
            }
            return;
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-run-detection
        let Some(detection) = self.detection_for(&bundle_id, &app_name, state.phase, now) else {
            return;
        };
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-run-detection
        // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-if-prompt
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-show-prompt
        self.set_detection(Some(detection));
        // Hidden for presenting: nothing is drawn; the menu still offers the recording.
        if !self.app().presenting.hidden {
            self.deps.surfaces.show_record_prompt();
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-show-prompt
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-if-prompt
        // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
    }

    // @cpt-algo:cpt-noter-algo-core-capture-session-detection:p1
    fn detection_for(
        &self,
        bundle_id: &str,
        app_name: &str,
        phase: CapturePhase,
        now: i64,
    ) -> Option<CallDetection> {
        // @cpt-begin:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-ignore
        let on = {
            let fr = lock(&self.first_run);
            first_run::detection(fr.offer_to_record, &fr.stored.self_test).0
        };
        let ignored = lock(&self.settings)
            .general
            .ignored_apps
            .iter()
            .any(|a| a.bundle_id == bundle_id);
        let capturing = !matches!(phase, CapturePhase::Idle | CapturePhase::Stopped);
        // One prompt per call: a detection kept after its prompt is not prompted again.
        let known = self
            .detection_now()
            .is_some_and(|d| d.bundle_id == bundle_id);
        if !on || ignored || capturing || known {
            return None;
        }
        // @cpt-end:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-ignore
        // @cpt-begin:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-match
        let matched_event = self.deps.native.calendar_event_near(TimestampMs(now));
        // @cpt-end:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-match
        // @cpt-begin:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-blocked
        let blocked = match self.start_guard(phase) {
            Err(e) if e.code == ErrorCode::DiskFull => Some(StartBlocked::DiskFull),
            Err(e) if e.code == ErrorCode::ModelMissing => Some(StartBlocked::ModelMissing),
            _ => None,
        };
        // @cpt-end:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-blocked
        // @cpt-begin:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-prompt
        Some(CallDetection {
            id: DetectionId::new(format!("det_{}", ulid::Ulid::generate())),
            app_name: app_name.into(),
            bundle_id: bundle_id.into(),
            matched_event,
            detected_at: TimestampMs(now),
            prompt_until: TimestampMs(now + PROMPT_MS),
            blocked,
        })
        // @cpt-end:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-prompt
    }

    /// The detection a start names, used up by the start. From the record prompt it must be
    /// within its 15 s; the menu bar and the hotkey may use a kept one later.
    pub(crate) fn take_detection(
        &self,
        args: &CaptureStartArgs,
        now: i64,
    ) -> Result<Option<CallDetection>, CoreError> {
        let Some(id) = &args.detection_id else {
            return Ok(None);
        };
        let detection = self.detection_now().filter(|d| d.id == *id);
        let from_prompt = args.source == StartSource::RecordPrompt;
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-if-expired
        match detection {
            None if from_prompt => Err(detection_expired()),
            Some(d) if from_prompt && now >= d.prompt_until.0 => Err(detection_expired()),
            other => Ok(other),
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-if-expired
    }

    pub(crate) fn dismiss_detection(&self, args: DismissDetectionArgs) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-dismiss
        let mut detection = self
            .detection_now()
            .filter(|d| d.id == args.detection_id)
            .ok_or_else(detection_expired)?;
        detection.prompt_until = self.deps.clock.now();
        self.set_detection(Some(detection));
        self.deps.surfaces.close_record_prompt();
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-dismiss
        Ok(Ack {})
    }

    pub(crate) fn ignore_app(
        &self,
        ctx: &CommandCtx,
        args: IgnoreAppArgs,
    ) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-ignore
        if self
            .detection_now()
            .is_some_and(|d| d.bundle_id == args.bundle_id)
        {
            self.set_detection(None);
            self.deps.surfaces.close_record_prompt();
        }
        let mut settings = lock(&self.settings);
        if settings
            .general
            .ignored_apps
            .iter()
            .any(|a| a.bundle_id == args.bundle_id)
        {
            return Ok(Ack {});
        }
        let mut general = settings.general.clone();
        general.ignored_apps.push(IgnoredApp {
            bundle_id: args.bundle_id,
            app_name: args.app_name,
        });
        let section = SettingsSection::General(general);
        let rev = self.write_section(ctx, &settings, &section, None, "capture_ignore_app")?;
        self.settings_written(&mut settings, section, rev);
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-ignore
        Ok(Ack {})
    }

    /// The meeting app let go of audio and microphone.
    pub(crate) async fn audio_released(&self, bundle_id: String) {
        let mut session = self.capture.lock().await;
        // @cpt-begin:cpt-noter-flow-core-capture-session-record-detected:p1:inst-detection-ends
        if self
            .detection_now()
            .is_some_and(|d| d.bundle_id == bundle_id)
        {
            self.set_detection(None);
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-record-detected:p1:inst-detection-ends
        let state = self.capture_now();
        let ours = session.app.as_ref().is_some_and(|(b, _)| *b == bundle_id);
        if !ours || !matches!(state.phase, CapturePhase::Recording | CapturePhase::Paused) {
            return;
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-released-fact
        // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-start-notice
        session.released += 1;
        let released = session.released;
        self.after(RELEASED_MS, move |core| async move {
            core.call_end_due(released).await;
        });
        // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-start-notice
        // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-released-fact
    }

    // @cpt-algo:cpt-noter-algo-core-capture-session-notice-timers:p1
    async fn call_end_due(&self, released: u64) {
        let session = self.capture.lock().await;
        let state = self.capture_now();
        let live_now = matches!(state.phase, CapturePhase::Recording | CapturePhase::Paused);
        if session.released != released || !live_now || state.notice.is_some() {
            return;
        }
        let now = self.deps.clock.now().0;
        // @cpt-begin:cpt-noter-flow-ui-record-prompt-notice:p1:inst-core-notice
        // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-call-end
        let (notice, stops_in) = if self.app().presenting.hidden {
            let at = TimestampMs(now + SEEMS_ENDED_MS);
            (
                CaptureNotice::CallSeemsEnded { stops_at: at },
                SEEMS_ENDED_MS,
            )
        } else {
            let at = Some(TimestampMs(now + COUNTDOWN_MS));
            (CaptureNotice::CallEnded { stops_at: at }, COUNTDOWN_MS)
        };
        self.set_notice(Some(notice.clone()));
        self.stop_when_due(notice, stops_in);
        // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-call-end
        // @cpt-end:cpt-noter-flow-ui-record-prompt-notice:p1:inst-core-notice
    }

    /// Stops the call when `notice` still shows after `ms`.
    fn stop_when_due(&self, notice: CaptureNotice, ms: i64) {
        self.after(ms, move |core| async move {
            // Checked and stopped under one lock: an answer that lands first wins.
            let mut session = core.capture.lock().await;
            let state = core.capture_now();
            let Some(call_id) = state.call_id.filter(|_| state.notice == Some(notice)) else {
                return;
            };
            // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-auto-stop
            session.auto_stop = true;
            let args = CallIdArgs { call_id };
            let _ = core.stop_locked(session, &timer_ctx(), args, None).await;
            // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-auto-stop
        });
    }

    pub(crate) async fn hold_notice(
        &self,
        args: NoticeHoldArgs,
    ) -> Result<CaptureState, CoreError> {
        let _session = self.capture.lock().await;
        let state = self.capture_now();
        let ended = matches!(state.notice, Some(CaptureNotice::CallEnded { .. }));
        if !live(&state, &args.call_id) || !ended {
            return Err(notice_expired());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-hold
        // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-hold
        if args.held {
            return Ok(self.set_notice(Some(CaptureNotice::CallEnded { stops_at: None })));
        }
        let at = self.deps.clock.now().0 + COUNTDOWN_MS;
        let notice = CaptureNotice::CallEnded {
            stops_at: Some(TimestampMs(at)),
        };
        let state = self.set_notice(Some(notice.clone()));
        self.stop_when_due(notice, COUNTDOWN_MS);
        // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-hold
        // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-hold
        Ok(state)
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-call-end:p1
    pub(crate) async fn answer_call_end(
        &self,
        ctx: &CommandCtx,
        args: CallEndAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let shown = matches!(
            state.notice,
            Some(CaptureNotice::CallEnded { .. } | CaptureNotice::CallSeemsEnded { .. })
        );
        if !live(&state, &args.call_id) || !shown {
            return Err(notice_expired());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-answer
        if args.choice == CallEndChoice::KeepRecording {
            session.released += 1;
            return Ok(self.set_notice(None));
        }
        drop(session);
        let stopped = self
            .stop_call(
                ctx,
                CallIdArgs {
                    call_id: args.call_id,
                },
            )
            .await;
        // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-answer
        // @cpt-begin:cpt-noter-flow-core-capture-session-call-end:p1:inst-return-call-end
        stopped
        // @cpt-end:cpt-noter-flow-core-capture-session-call-end:p1:inst-return-call-end
    }

    /// Starts (again) the 5 minutes after which nothing heard raises its notice.
    pub(crate) fn listen_for_speech(&self, session: &mut crate::capture::Session) {
        session.heard = Some(tokio::time::Instant::now());
        session.heard_since = self.deps.clock.now().0;
        session.heard_chain += 1;
        let chain = session.heard_chain;
        self.after(NOTHING_HEARD_MS, move |core| async move {
            core.nothing_heard_due(chain).await;
        });
    }

    async fn nothing_heard_due(&self, chain: u64) {
        loop {
            let session = self.capture.lock().await;
            let state = self.capture_now();
            let live_now = matches!(state.phase, CapturePhase::Recording | CapturePhase::Paused);
            if session.heard_chain != chain || !live_now {
                return;
            }
            let heard = session.heard.unwrap_or_else(tokio::time::Instant::now);
            let due = heard + Duration::from_millis(NOTHING_HEARD_MS as u64);
            if tokio::time::Instant::now() >= due {
                // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-nothing-heard
                if state.notice.is_none() {
                    let since = TimestampMs(session.heard_since);
                    self.set_notice(Some(CaptureNotice::NothingHeard { since }));
                }
                // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-nothing-heard
                return;
            }
            drop(session);
            tokio::time::sleep_until(due).await;
        }
    }

    /// A segment of the live call arrived: something was heard.
    pub(crate) async fn heard(&self, call_id: &CallId) {
        let mut session = self.capture.lock().await;
        if self.capture_now().call_id.as_ref() == Some(call_id) {
            session.heard = Some(tokio::time::Instant::now());
            session.heard_since = self.deps.clock.now().0;
        }
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-notices:p1
    // @cpt-dod:cpt-noter-dod-core-capture-session-notices:p1
    pub(crate) async fn keep_recording(&self, args: CallIdArgs) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let shown = matches!(state.notice, Some(CaptureNotice::NothingHeard { .. }));
        if !live(&state, &args.call_id) || !shown {
            return Err(notice_expired());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-notices:p1:inst-keep-recording
        self.listen_for_speech(&mut session);
        let state = self.set_notice(None);
        // @cpt-end:cpt-noter-flow-core-capture-session-notices:p1:inst-keep-recording
        Ok(state)
    }

    pub(crate) async fn answer_new_meeting(
        &self,
        ctx: &CommandCtx,
        args: NewMeetingAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let shown = matches!(state.notice, Some(CaptureNotice::NewMeeting { .. }));
        if !live(&state, &args.call_id) || !shown {
            return Err(notice_expired());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-notices:p1:inst-new-meeting
        if args.choice == NewMeetingChoice::KeepInThisCall {
            session.new_meeting = None;
            return Ok(self.set_notice(None));
        }
        drop(session);
        self.split_call(ctx).await
        // @cpt-end:cpt-noter-flow-core-capture-session-notices:p1:inst-new-meeting
    }

    /// Start as New Call: the live call ends at the new meeting's `detected_at` and a new call
    /// starts there, named after the calendar event, else the meeting app.
    // D-33: the saved call is closed for good; only the live call can be stopped and continued.
    async fn split_call(&self, ctx: &CommandCtx) -> Result<CaptureState, CoreError> {
        // The notice is checked and the old call stopped under one lock.
        let mut session = self.capture.lock().await;
        let (call_id, detected_at, app, title) = {
            let state = self.capture_now();
            let (
                Some(call_id),
                Some(CaptureNotice::NewMeeting {
                    detected_at,
                    event,
                    app_name,
                    ..
                }),
            ) = (state.call_id, state.notice)
            else {
                return Err(notice_expired());
            };
            let title = event.map(|e| e.title).or(app_name);
            (call_id, detected_at.0, session.new_meeting.take(), title)
        };
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-split
        let args = CallIdArgs { call_id };
        self.stop_locked(session, ctx, args, Some(detected_at))
            .await?;
        let begin = Begin {
            at: detected_at,
            title,
            app,
        };
        self.begin_call(ctx, false, begin).await
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-split
    }

    /// The engine heard another app play into the call.
    pub(crate) async fn source_added(&self, call_id: CallId, bundle_id: String, app_name: String) {
        let session = self.capture.lock().await;
        if !live(&self.capture_now(), &call_id) || session.kept_sources.contains(&bundle_id) {
            return;
        }
        let since = self.deps.clock.now();
        // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-second-source
        self.edit_degraded(|states| {
            let shown = states.iter().any(|s| {
                matches!(s, DegradedState::SecondAudioSource { bundle_id: b, .. } if *b == bundle_id)
            });
            if !shown {
                states.push(DegradedState::SecondAudioSource {
                    call_id,
                    app_name,
                    bundle_id,
                    since,
                });
            }
        });
        // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-second-source
    }

    /// Takes the second-source banner of `bundle_id` down; `false` when none showed.
    fn drop_second_source(&self, bundle_id: &str) -> bool {
        let mut found = false;
        self.edit_degraded(|states| {
            states.retain(|s| {
                let this = matches!(
                    s,
                    DegradedState::SecondAudioSource { bundle_id: b, .. } if b == bundle_id
                );
                found |= this;
                !this
            });
        });
        found
    }

    pub(crate) async fn keep_source(
        &self,
        args: KeepSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        if !live(&state, &args.call_id) {
            return Err(not_recording());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-notices:p1:inst-second-source
        if !self.drop_second_source(&args.bundle_id) {
            return Err(notice_expired());
        }
        session.kept_sources.push(args.bundle_id);
        Ok(state)
    }

    pub(crate) async fn exclude_source(
        &self,
        args: ExcludeSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        let _session = self.capture.lock().await;
        let state = self.capture_now();
        if !live(&state, &args.call_id) {
            return Err(not_recording());
        }
        self.drop_second_source(&args.bundle_id);
        let exclude = EngineCommand::ExcludeProcess {
            call_id: args.call_id,
            bundle_id: args.bundle_id,
        };
        self.engine.command(exclude).await?;
        // @cpt-end:cpt-noter-flow-core-capture-session-notices:p1:inst-second-source
        // @cpt-begin:cpt-noter-flow-core-capture-session-notices:p1:inst-return-notices
        Ok(state)
        // @cpt-end:cpt-noter-flow-core-capture-session-notices:p1:inst-return-notices
    }

    /// The stopped call leaves Continue at `until`, unless something else happened first.
    pub(crate) fn close_continue_at(&self, call_id: CallId, until: TimestampMs, ms: i64) {
        self.after(ms, move |core| async move {
            let mut session = core.capture.lock().await;
            let state = core.capture_now();
            let same = state.phase == CapturePhase::Stopped
                && state.call_id.as_ref() == Some(&call_id)
                && state.continue_until == Some(until);
            if same {
                // @cpt-begin:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-continue
                // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-idle
                *session = session.restart(0);
                core.set_capture(crate::capture::to_idle);
                // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-idle
                // @cpt-end:cpt-noter-algo-core-capture-session-notice-timers:p1:inst-timer-continue
            }
        });
    }

    pub(crate) fn edit_degraded(&self, edit: impl FnOnce(&mut Vec<DegradedState>)) {
        let mut app = self.app();
        let mut states = app.degraded.states.clone();
        edit(&mut states);
        if states != app.degraded.states {
            app.degraded.states = states;
            self.publish(event_names::DEGRADED_CHANGED, &mut app.degraded);
        }
    }

    /// Hidden for presenting, as `harness.world_set` asks (native surfaces own it in the app).
    #[cfg(feature = "harness")]
    pub(crate) fn seed_presenting(&self, hidden: bool) {
        self.set_hidden_for_presenting(hidden);
    }

    /// Second-source banners of a call that ended.
    pub(crate) fn drop_sources_of(&self, call_id: &CallId) {
        self.edit_degraded(|states| {
            states.retain(|s| {
                !matches!(s, DegradedState::SecondAudioSource { call_id: c, .. } if c == call_id)
            });
        });
    }
}
