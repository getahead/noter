//! The capture session as the supervisor sees it (`docs/features/core/core-engine-capture.md`):
//! its states, the capture-first restart of an engine that dies mid-call, and the translation
//! of engine facts into degraded states and gaps for the session manager. Times are offsets
//! into the call (tokio time since the first `session_started`); the session manager maps them
//! to timestamps with its own clock.

use std::collections::VecDeque;
use std::mem::discriminant;
use std::time::Duration;

use noter_protocol::engine::{EngineCommand, EngineErrorCode, EngineEvent, StartSession};
use noter_protocol::model::{GapReason, GapView};
use noter_protocol::{CallId, OffsetMs};
use tokio::sync::broadcast;
use tokio::time::Instant;

use crate::{CommandError, EngineClient, EngineLauncher, EngineState, Shared};

/// Capture-first restarts: this many crashes or failed starts within the window fail the capture
/// (TL-8; separate from the idle rule's 3 in 60 s).
const MAX_FAILURES: usize = 3;
const FAILURE_WINDOW: Duration = Duration::from_secs(30);
/// No segment for this long while audio flows is a stalled transcription.
const STALL_MS: u32 = 10_000;
/// The engine reports a channel of exact digital zeros at this level.
const ZEROS_DB: f32 = -120.0;
/// Above this level a channel carries audio (speech or call sound).
const AUDIO_DB: f32 = -60.0;

// @cpt-state:cpt-noter-state-core-engine-capture-session:p1
/// The engine session (engine-capture §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineSession {
    Idle,
    Starting,
    Capturing,
    Paused,
    Restarting,
    Stopping,
    Stopped,
    Failed,
}

/// A degraded state of the running call; the session manager turns it into a `DegradedState`.
#[derive(Debug, Clone, PartialEq)]
pub enum Degraded {
    TranscriptionStalled,
    SystemAudioSilent { confidence: f32 },
    MicrophoneOff,
    DeviceChanged { device_name: String, gap_ms: u32 },
    CaptureFailed,
}

/// What the session manager hears about a session besides [`EngineClient::events`].
#[derive(Debug, Clone, PartialEq)]
pub enum CaptureFact {
    /// A gap in the recording: `engine_restart`, `device_changed` or `stalled`.
    Gap(GapView),
    /// A degraded state begins (`since_ms` into the call); a new one of the same kind replaces it.
    Degraded {
        call_id: CallId,
        state: Degraded,
        since_ms: OffsetMs,
    },
    /// A degraded state ends (the same rule in reverse, or the session stopped).
    Cleared { call_id: CallId, state: Degraded },
}

pub(crate) struct Session {
    state: EngineSession,
    start: StartSession,
    /// Paused before a crash: paused again after the restart.
    paused: bool,
    started_at: Option<Instant>,
    last_event: Option<Instant>,
    failures: VecDeque<Instant>,
    /// Start of the `engine_restart` gap the next `session_started` closes.
    gap_from: Option<u32>,
    no_segments_since: Option<u32>,
    active: Vec<Degraded>,
}

impl Session {
    fn offset(&self, at: Instant) -> u32 {
        self.started_at.map_or(0, |s| {
            u32::try_from(at.saturating_duration_since(s).as_millis()).unwrap_or(u32::MAX)
        })
    }

    fn running(&self) -> bool {
        matches!(
            self.state,
            EngineSession::Starting
                | EngineSession::Capturing
                | EngineSession::Paused
                | EngineSession::Restarting
        )
    }

    fn gap(&self, t0: u32, t1: u32, reason: GapReason) -> CaptureFact {
        CaptureFact::Gap(GapView {
            call_id: self.start.call_id.clone(),
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t1),
            reason,
        })
    }

    fn raise(&mut self, out: &mut Vec<CaptureFact>, state: Degraded, since: u32) {
        if let Some(i) = self.kind(&state) {
            if self.active[i] == state {
                return;
            }
            self.active.remove(i);
        }
        self.active.push(state.clone());
        out.push(CaptureFact::Degraded {
            call_id: self.start.call_id.clone(),
            state,
            since_ms: OffsetMs(since),
        });
    }

    fn clear(&mut self, out: &mut Vec<CaptureFact>, like: &Degraded) -> bool {
        let Some(i) = self.kind(like) else {
            return false;
        };
        let state = self.active.remove(i);
        out.push(CaptureFact::Cleared {
            call_id: self.start.call_id.clone(),
            state,
        });
        true
    }

    fn kind(&self, like: &Degraded) -> Option<usize> {
        self.active
            .iter()
            .position(|d| discriminant(d) == discriminant(like))
    }

    /// The session ended: every active state clears.
    fn stopped(&mut self, out: &mut Vec<CaptureFact>) {
        // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-stopped
        self.state = EngineSession::Stopped;
        // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-stopped
        for state in std::mem::take(&mut self.active) {
            out.push(CaptureFact::Cleared {
                call_id: self.start.call_id.clone(),
                state,
            });
        }
    }

    /// Counts a crash or failed start; `true` when the capture must give up.
    fn failed(&mut self, now: Instant) -> bool {
        self.failures.push_back(now);
        while self
            .failures
            .front()
            .is_some_and(|t| now - *t > FAILURE_WINDOW)
        {
            self.failures.pop_front();
        }
        self.failures.len() >= MAX_FAILURES
    }

    // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-if-restart-fails
    fn give_up(&mut self, out: &mut Vec<CaptureFact>) {
        // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-failed
        self.state = EngineSession::Failed;
        // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-failed
        // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-return-failed
        // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-restart-states
        let since = self.gap_from.unwrap_or(0);
        self.raise(out, Degraded::CaptureFailed, since);
        // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-restart-states
        // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-return-failed
    }
    // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-if-restart-fails
}

impl<L: EngineLauncher> EngineClient<L> {
    pub fn session(&self) -> EngineSession {
        self.shared()
            .session
            .as_ref()
            .map_or(EngineSession::Idle, |s| s.state)
    }

    /// Gaps and degraded states of the running session, next to [`EngineClient::events`].
    pub fn capture_facts(&self) -> broadcast::Receiver<CaptureFact> {
        self.inner.facts.subscribe()
    }

    /// Starts capturing a call: `starting` until the engine's `session_started`.
    pub async fn start_session(&self, start: StartSession) -> Result<(), CommandError> {
        // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-starting
        self.shared().session = Some(Session {
            state: EngineSession::Starting,
            start: start.clone(),
            paused: false,
            started_at: None,
            last_event: None,
            failures: VecDeque::new(),
            gap_from: None,
            no_segments_since: None,
            active: Vec::new(),
        });
        // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-starting
        let Err(e) = self.command(EngineCommand::StartSession(start)).await else {
            return Ok(());
        };
        let mut s = self.shared();
        match s.session.as_ref().map(|x| (x.state, x.failures.is_empty())) {
            // The engine died after taking the command: the capture-first restart has it.
            Some((EngineSession::Restarting | EngineSession::Capturing, false)) => Ok(()),
            // Failed after a crash: kept for Try Again.
            Some((EngineSession::Failed, false)) => Err(e),
            _ => {
                s.session = None;
                Err(e)
            }
        }
    }

    pub async fn pause_session(&self) -> Result<(), CommandError> {
        let call_id = self.call_id(&[EngineSession::Capturing])?;
        self.command(EngineCommand::Pause { call_id }).await?;
        if let Some(x) = self.shared().session.as_mut() {
            // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-paused
            x.state = EngineSession::Paused;
            x.paused = true;
            // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-paused
        }
        Ok(())
    }

    pub async fn resume_session(&self) -> Result<(), CommandError> {
        let call_id = self.call_id(&[EngineSession::Paused])?;
        self.command(EngineCommand::Resume { call_id }).await?;
        if let Some(x) = self.shared().session.as_mut() {
            // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-resumed
            x.state = EngineSession::Capturing;
            x.paused = false;
            // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-resumed
        }
        Ok(())
    }

    /// Stops the session: `stopping` until the engine's `session_stopped`.
    pub async fn stop_session(&self) -> Result<(), CommandError> {
        let call_id = self.call_id(&[
            EngineSession::Starting,
            EngineSession::Capturing,
            EngineSession::Paused,
        ])?;
        if let Some(x) = self.shared().session.as_mut() {
            // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-stopping
            x.state = EngineSession::Stopping;
            // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-stopping
        }
        self.command(EngineCommand::Stop { call_id }).await
    }

    /// **Try Again** after the capture failed (`capture_resume_interrupted`, D-15).
    pub async fn try_again(&self) -> Result<(), CommandError> {
        {
            let mut s = self.shared();
            let Some(x) = s
                .session
                .as_mut()
                .filter(|x| x.state == EngineSession::Failed)
            else {
                return Err(CommandError::Unavailable);
            };
            // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-try-again
            x.state = EngineSession::Restarting;
            x.failures.clear();
            // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-try-again
            s.state = EngineState::Restarting;
        }
        self.clone().restart_capture().await;
        match self.session() {
            EngineSession::Failed => Err(CommandError::Unavailable),
            _ => Ok(()),
        }
    }

    /// The session's call, when the session is in one of the states `from`.
    fn call_id(&self, from: &[EngineSession]) -> Result<CallId, CommandError> {
        self.shared()
            .session
            .as_ref()
            .filter(|x| from.contains(&x.state))
            .map(|x| x.start.call_id.clone())
            .ok_or(CommandError::Unavailable)
    }

    fn send_facts(&self, facts: Vec<CaptureFact>) {
        for fact in facts {
            // No subscriber is not an error.
            let _ = self.inner.facts.send(fact);
        }
    }

    /// A running engine died (`s` is locked). `Some(true)`: the capture-first restart takes
    /// over; `Some(false)`: the capture failed; `None`: no session runs, the idle rule applies.
    pub(crate) fn crash_during_capture(&self, s: &mut Shared) -> Option<bool> {
        let mut facts = Vec::new();
        let x = s.session.as_mut()?;
        if x.state == EngineSession::Stopping {
            // It was ending anyway; the `stop` command reports the failure.
            x.stopped(&mut facts);
            self.send_facts(facts);
            return None;
        }
        if !x.running() {
            return None;
        }
        // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-see-crash
        let now = Instant::now();
        if x.started_at.is_some() && x.gap_from.is_none() {
            x.gap_from = Some(x.offset(x.last_event.unwrap_or(now)));
        }
        // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-restarting
        x.state = EngineSession::Restarting;
        // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-restarting
        // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-see-crash
        let restart = !x.failed(now);
        if !restart {
            x.give_up(&mut facts);
            s.state = EngineState::Unavailable;
        }
        self.send_facts(facts);
        Some(restart)
    }

    // @cpt-flow:cpt-noter-flow-core-engine-capture-recover:p1
    /// Respawns the engine at once and starts the same call again from where the audio stopped.
    pub(crate) async fn restart_capture(self) {
        // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-respawn
        loop {
            let started = {
                let mut conn = self.inner.conn.lock().await;
                self.start(&mut conn).await
            };
            if started.is_ok() {
                break;
            }
            let mut facts = Vec::new();
            {
                let mut s = self.shared();
                let Some(x) = s.session.as_mut().filter(|x| x.running()) else {
                    return;
                };
                if !x.failed(Instant::now()) {
                    continue;
                }
                x.give_up(&mut facts);
                s.state = EngineState::Unavailable;
            }
            self.send_facts(facts);
            return;
        }
        let (start, paused) = {
            let s = self.shared();
            let Some(x) = s.session.as_ref().filter(|x| x.running()) else {
                return;
            };
            let mut start = x.start.clone();
            start.resume_from_ms = x.gap_from.map(OffsetMs);
            (start, x.paused)
        };
        let call_id = start.call_id.clone();
        // A failure here is another crash: the reader's close starts the next restart.
        if self
            .command(EngineCommand::StartSession(start))
            .await
            .is_ok()
            && paused
        {
            // `session_started` then lands in `paused`.
            let _ = self.command(EngineCommand::Pause { call_id }).await;
        }
        // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-respawn
    }

    // @cpt-algo:cpt-noter-algo-core-engine-capture-degraded:p1
    /// Session facts from one engine event (not replies); facts go out after the lock.
    pub(crate) fn on_capture_event(&self, event: &EngineEvent) {
        let mut out = Vec::new();
        {
            let mut s = self.shared();
            let Some(x) = s
                .session
                .as_mut()
                .filter(|x| x.running() || x.state == EngineSession::Stopping)
            else {
                return;
            };
            let now = Instant::now();
            match event {
                EngineEvent::SessionStarted { .. } => {
                    x.started_at.get_or_insert(now);
                    let resumed = x.state == EngineSession::Restarting;
                    // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-capturing
                    // @cpt-begin:cpt-noter-state-core-engine-capture-session:p1:inst-st-recovered
                    // A session paused before a crash stays paused (its `pause` is sent again).
                    x.state = if x.paused {
                        EngineSession::Paused
                    } else {
                        EngineSession::Capturing
                    };
                    // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-recovered
                    // @cpt-end:cpt-noter-state-core-engine-capture-session:p1:inst-st-capturing
                    if resumed {
                        // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-return-recovered
                        x.clear(&mut out, &Degraded::CaptureFailed);
                        // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-return-recovered
                    }
                    // @cpt-begin:cpt-noter-flow-core-engine-capture-recover:p1:inst-report-gap
                    if let Some(from) = x.gap_from.take() {
                        out.push(x.gap(from, x.offset(now), GapReason::EngineRestart));
                    }
                    // @cpt-end:cpt-noter-flow-core-engine-capture-recover:p1:inst-report-gap
                }
                EngineEvent::SessionStopped { .. } => x.stopped(&mut out),
                // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-stalled
                EngineEvent::NoSegments { since_ms, .. } => {
                    x.no_segments_since.get_or_insert(since_ms.0);
                }
                EngineEvent::Segment { segment } => {
                    if let Some(since) = x.no_segments_since.take() {
                        if x.clear(&mut out, &Degraded::TranscriptionStalled) {
                            let to = segment.t0_ms.0.max(since);
                            out.push(x.gap(since, to, GapReason::Stalled));
                        }
                    }
                }
                // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-stalled
                EngineEvent::Levels { mic_db, sys_db, .. } => {
                    let at = x.offset(now);
                    if let Some(since) = x.no_segments_since {
                        if (*mic_db > AUDIO_DB || *sys_db > AUDIO_DB)
                            && at >= since.saturating_add(STALL_MS)
                        {
                            x.raise(&mut out, Degraded::TranscriptionStalled, since);
                        }
                    }
                    if *sys_db > ZEROS_DB {
                        x.clear(&mut out, &Degraded::SystemAudioSilent { confidence: 0.0 });
                    }
                    // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-mic-off
                    if *mic_db > ZEROS_DB {
                        x.clear(&mut out, &Degraded::MicrophoneOff);
                    } else if *sys_db > AUDIO_DB {
                        x.raise(&mut out, Degraded::MicrophoneOff, at);
                    }
                    // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-mic-off
                }
                // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-silent
                EngineEvent::SystemAudioSilent {
                    since_ms,
                    confidence,
                    ..
                } => {
                    let state = Degraded::SystemAudioSilent {
                        confidence: *confidence,
                    };
                    x.raise(&mut out, state, since_ms.0);
                }
                // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-silent
                EngineEvent::Error {
                    cmd_id: None,
                    code: EngineErrorCode::DeviceUnavailable,
                    ..
                } => {
                    let at = x.offset(now);
                    x.raise(&mut out, Degraded::MicrophoneOff, at);
                }
                // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-device
                EngineEvent::DeviceChanged {
                    device_name,
                    gap_from_ms,
                    gap_to_ms,
                    ..
                } => {
                    let state = Degraded::DeviceChanged {
                        device_name: device_name.clone(),
                        gap_ms: gap_to_ms.0.saturating_sub(gap_from_ms.0),
                    };
                    x.raise(&mut out, state, gap_from_ms.0);
                    out.push(x.gap(gap_from_ms.0, gap_to_ms.0, GapReason::DeviceChanged));
                }
                // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-device
                _ => {}
            }
            x.last_event = Some(now);
        }
        // @cpt-begin:cpt-noter-algo-core-engine-capture-degraded:p1:inst-return-degraded
        self.send_facts(out);
        // @cpt-end:cpt-noter-algo-core-engine-capture-degraded:p1:inst-return-degraded
    }
}
