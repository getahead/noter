//! The first-run self-test (`cpt-noter-flow-core-first-run-self-test`): the core checks the
//! microphone permission (decision E2), asks the engine through the supervisor (S12), maps
//! its events to `SelfTestMsg` on a one-off hub stream, stores the result and applies the
//! detection rule. The engine reports no channel or timeout reason, so `OneStreamSilent` and
//! `TimedOut` are rebuilt from the streams that arrived.

use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use noter_engine_client::{EngineClient, EngineLauncher, LaunchFuture};
use noter_protocol::engine::{EngineCommand, EngineErrorCode, EngineEvent};
use noter_protocol::ipc::{CommandCtx, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use tokio::sync::broadcast::error::RecvError;

use crate::first_run::detection;
use crate::hub::{StreamHub, StreamMsg};
use crate::{internal, lock, Core};

/// The engine as the core holds it.
pub(crate) type Engine = EngineClient<Arc<dyn EngineLauncher>>;

/// No engine configured: a launch fails, so engine commands answer `engine_unavailable`.
pub(crate) struct NoEngine;

impl EngineLauncher for NoEngine {
    fn launch(&self) -> LaunchFuture<'_> {
        Box::pin(async { Err(io::Error::new(io::ErrorKind::NotFound, "no engine")) })
    }
}

impl StreamMsg for SelfTestMsg {
    fn set_seq(&mut self, seq: Seq) {
        self.seq = seq;
    }
    fn ended(reason: StreamEndReason) -> Option<Self> {
        Some(SelfTestMsg {
            seq: Seq(0),
            event: SelfTestEvent::Ended { reason },
        })
    }
}

/// The engine's self-test window; the result must arrive within it plus a margin.
const WINDOW_MS: u32 = 10_000;
/// The short test that brings up the System Audio Recording prompt.
const PROMPT_MS: u32 = 3_000;
const MARGIN: Duration = Duration::from_secs(2);
/// One system-audio re-check per activation: notices within this window ask once (D-19).
const RECHECK_EVERY: Duration = Duration::from_secs(5);
static NEXT_RUN: AtomicU64 = AtomicU64::new(1);

/// The channel that delivered nothing, or `TimedOut` when none or both arrived.
fn silent(arrived: &[AudioChannel]) -> SelfTestFailure {
    match [AudioChannel::Mic, AudioChannel::Sys]
        .into_iter()
        .find(|c| !arrived.contains(c))
    {
        Some(channel) if !arrived.is_empty() => SelfTestFailure::OneStreamSilent { channel },
        _ => SelfTestFailure::TimedOut,
    }
}

fn reason(
    passed: bool,
    failure: Option<EngineErrorCode>,
    own_sounds_leak: bool,
    arrived: &[AudioChannel],
) -> Result<(), SelfTestFailure> {
    if passed {
        return Ok(());
    }
    if own_sounds_leak {
        return Err(SelfTestFailure::OwnSoundsLeak);
    }
    Err(match failure {
        Some(EngineErrorCode::ZeroBuffers) => SelfTestFailure::ZeroBuffers,
        Some(EngineErrorCode::ModelMissing | EngineErrorCode::ModelLoadFailed) => {
            SelfTestFailure::ModelMissing
        }
        // The core checked the microphone first (E2); what is left is system audio.
        Some(EngineErrorCode::PermissionMissing) => SelfTestFailure::PermissionMissing {
            kind: PermissionKind::SystemAudio,
        },
        _ => silent(arrived),
    })
}

impl Core {
    fn self_test_hub(&self) -> Arc<StreamHub<SelfTestMsg>> {
        self.self_test_hub
            .get_or_init(|| self.stream_hub(None))
            .clone()
    }

    // @cpt-flow:cpt-noter-flow-core-first-run-self-test:p1
    // @cpt-dod:cpt-noter-dod-core-first-run-self-test:p1
    pub(crate) fn start_self_test(
        &self,
        ctx: &CommandCtx,
        args: SelfTestArgs,
        channel: Sink<SelfTestMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-self-test-call
        let Some(core) = self.this() else {
            return Err(internal("first run has not started"));
        };
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-self-test-call
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-if-model-missing
        if !lock(&self.downloads).capture_ready() {
            return Err(CoreError::new(
                ErrorCode::ModelMissing,
                "the live model is not downloaded",
            ));
        }
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-if-model-missing
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-register-stream
        let key = format!("self_test_{}", NEXT_RUN.fetch_add(1, Ordering::Relaxed));
        let sub = self.subscribe(&self.self_test_hub(), &key, ctx, channel, || Ok(()))?;
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-register-stream
        // @cpt-begin:cpt-noter-state-core-first-run-self-test:p1:inst-st-run
        // @cpt-begin:cpt-noter-state-core-first-run-self-test:p1:inst-st-rerun
        lock(&self.first_run).self_test_running = true;
        self.refresh_setup();
        // @cpt-end:cpt-noter-state-core-first-run-self-test:p1:inst-st-rerun
        // @cpt-end:cpt-noter-state-core-first-run-self-test:p1:inst-st-run
        let ctx = ctx.clone();
        tokio::spawn(async move { core.drive_self_test(ctx, key, args.play_clip).await });
        Ok(SubscriptionHandle {
            subscription_id: sub.subscription_id,
        })
    }

    async fn drive_self_test(self: Arc<Self>, ctx: CommandCtx, key: String, play_clip: bool) {
        let hub = self.self_test_hub();
        let send = |event| {
            hub.publish(&key, SelfTestMsg { seq: Seq(0), event });
        };
        let microphone = self.deps.native.permission(PermissionKind::Microphone);
        let result = if microphone == PermissionState::Granted {
            self.engine_self_test(play_clip, &send).await
        } else {
            // Decision E2: the core decides a missing permission before asking the engine.
            Err(SelfTestFailure::PermissionMissing {
                kind: PermissionKind::Microphone,
            })
        };
        // @cpt-begin:cpt-noter-state-core-first-run-self-test:p1:inst-st-passed
        // @cpt-begin:cpt-noter-state-core-first-run-self-test:p1:inst-st-failed-test
        let state = match result {
            Ok(()) => {
                send(SelfTestEvent::Passed);
                SelfTestState::Passed {
                    at: self.deps.clock.now(),
                }
            }
            Err(reason) => {
                send(SelfTestEvent::Failed {
                    reason: reason.clone(),
                });
                SelfTestState::Failed { reason }
            }
        };
        // @cpt-end:cpt-noter-state-core-first-run-self-test:p1:inst-st-failed-test
        // @cpt-end:cpt-noter-state-core-first-run-self-test:p1:inst-st-passed
        self.finish_self_test(&ctx, state).await;
        hub.end_stream(&key, StreamEndReason::CallStopped);
    }

    // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-map-events
    async fn engine_self_test(
        &self,
        play_clip: bool,
        send: &impl Fn(SelfTestEvent),
    ) -> Result<(), SelfTestFailure> {
        let mut events = self.engine.events();
        // @cpt-begin:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-send-self-test
        let run = EngineCommand::SelfTest {
            play_clip,
            timeout_ms: WINDOW_MS,
        };
        if self.engine.command(run).await.is_err() {
            return Err(SelfTestFailure::TimedOut);
        }
        // @cpt-end:cpt-noter-flow-core-engine-foundation-self-test:p1:inst-send-self-test
        let mut arrived = Vec::new();
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(WINDOW_MS.into()) + MARGIN;
        loop {
            let line = match tokio::time::timeout_at(deadline, events.recv()).await {
                Ok(Ok(line)) => line,
                Ok(Err(RecvError::Lagged(_))) => continue,
                _ => return Err(silent(&arrived)),
            };
            match line.event {
                EngineEvent::SelfTestStream { channel } => {
                    arrived.push(channel);
                    send(SelfTestEvent::StreamArrived { channel });
                }
                EngineEvent::Levels { mic_db, sys_db, .. } => {
                    send(SelfTestEvent::Levels { mic_db, sys_db })
                }
                EngineEvent::SelfTestLine { channel, text } => {
                    send(SelfTestEvent::Line { channel, text })
                }
                EngineEvent::SelfTestResult {
                    passed,
                    failure,
                    own_sounds_leak,
                } => return reason(passed, failure, own_sounds_leak, &arrived),
                _ => {}
            }
        }
    }
    // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-map-events

    async fn finish_self_test(&self, ctx: &CommandCtx, state: SelfTestState) {
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-store-result
        let offer = {
            let mut fr = lock(&self.first_run);
            fr.self_test_running = false;
            let mut stored = fr.stored.clone();
            stored.self_test = state.clone();
            // The newest finding wins: this self-test, not an earlier probe.
            stored.system_audio = None;
            if self
                .store_setup(ctx, &fr.stored, &stored, "self_test_run")
                .is_ok()
            {
                fr.stored = stored;
            }
            fr.offer_to_record
        };
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-store-result
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-apply-detection
        let (on, _) = detection(offer, &state);
        self.send_detection(on).await;
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-apply-detection
        // @cpt-begin:cpt-noter-flow-core-first-run-self-test:p1:inst-emit-setup
        self.environment_changed(self.deps.native.environment());
        // @cpt-end:cpt-noter-flow-core-first-run-self-test:p1:inst-emit-setup
    }

    /// The app became active (the host calls it): re-check a denied system-audio row (D-19).
    pub fn app_activated(&self) {
        self.recheck_system_audio();
    }

    /// Decision D-19: macOS cannot be asked whether System Audio Recording is on, so while
    /// first run shows the row denied (never during a capture), one short engine test plays
    /// the test clip so a granted tap hears something; the row turns granted or stays denied,
    /// and `setup:changed` ends the check either way. Settings leaves it to Run Test.
    pub(crate) fn recheck_system_audio(&self) {
        let Some(core) = self.this() else { return };
        {
            let mut fr = lock(&self.first_run);
            let first_run = !fr
                .stored
                .steps
                .iter()
                .all(|r| matches!(r.state, StepState::Done | StepState::Skipped));
            let recent = fr.last_probe.is_some_and(|t| t.elapsed() < RECHECK_EVERY);
            if fr.probing
                || recent
                || fr.self_test_running
                || !first_run
                || crate::first_run::system_audio(&fr.stored) != PermissionState::Denied
                || self.app().capture.phase != CapturePhase::Idle
            {
                return;
            }
            fr.probing = true;
        }
        self.spawn(async move {
            // Own-sound leak detection does not apply: the clip is the signal here.
            let heard = core.short_engine_test(true).await;
            {
                let mut fr = lock(&core.first_run);
                if heard == PermissionState::Granted {
                    let mut stored = fr.stored.clone();
                    stored.system_audio = Some(PermissionState::Granted);
                    let ctx = CommandCtx {
                        caller: noter_protocol::ipc::Caller::Window {
                            label: WindowLabel::FirstRun,
                        },
                    };
                    if core
                        .store_setup(&ctx, &fr.stored, &stored, "system_audio_recheck")
                        .is_ok()
                    {
                        fr.stored = stored;
                    }
                }
                fr.probing = false;
                fr.last_probe = Some(std::time::Instant::now());
            }
            core.refresh_environment_now();
            core.refresh_setup_with(true);
        });
    }

    /// Tells a running engine the detection rule; a stopped engine gets it after its `ready`.
    /// Detection needs a running engine, so a stopped one starts when detection turns on.
    // @cpt-begin:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-ignore
    pub(crate) async fn send_detection(&self, on: bool) {
        let known = crate::notices::known_apps(&lock(&self.settings).general.ignored_apps);
        self.engine.set_detection_rule(on, known.clone());
        if self.engine.state() == noter_engine_client::EngineState::Ready {
            let _ = self
                .engine
                .command(EngineCommand::SetDetection {
                    enabled: on,
                    known_bundle_ids: known,
                })
                .await;
        } else if on {
            let _ = self.engine.ensure_ready().await;
        }
    }
    // @cpt-end:cpt-noter-algo-core-capture-session-detection:p1:inst-detect-ignore

    /// Decision F1: the System Audio Recording prompt comes from the engine opening its tap
    /// in a short self-test (no clip). What arrives is the inference: system audio heard →
    /// granted, only zeros → denied, otherwise not asked.
    pub(crate) async fn prompt_system_audio(&self) -> PermissionState {
        self.short_engine_test(false).await
    }

    /// A short engine self-test (about 3 s): what the tap heard of system audio.
    async fn short_engine_test(&self, play_clip: bool) -> PermissionState {
        let mut events = self.engine.events();
        let short = EngineCommand::SelfTest {
            play_clip,
            timeout_ms: PROMPT_MS,
        };
        if self.engine.command(short).await.is_err() {
            return PermissionState::NotAsked;
        }
        let deadline =
            tokio::time::Instant::now() + Duration::from_millis(PROMPT_MS.into()) + MARGIN;
        loop {
            let line = match tokio::time::timeout_at(deadline, events.recv()).await {
                Ok(Ok(line)) => line,
                Ok(Err(RecvError::Lagged(_))) => continue,
                _ => return PermissionState::NotAsked,
            };
            match line.event {
                EngineEvent::SelfTestStream {
                    channel: AudioChannel::Sys,
                } => return PermissionState::Granted,
                EngineEvent::SelfTestResult { failure, .. } => {
                    return match failure {
                        Some(EngineErrorCode::ZeroBuffers) => PermissionState::Denied,
                        _ => PermissionState::NotAsked,
                    }
                }
                _ => {}
            }
        }
    }
}
