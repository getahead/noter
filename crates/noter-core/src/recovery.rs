//! Recovery after a quit, a crash or an engine failure (`cpt-noter-flow-core-capture-session-resume`)
//! and the disk rows of `degraded:changed` (`cpt-noter-algo-core-capture-session-degraded`).

use noter_db::rusqlite::OptionalExtension;
use noter_engine_client::{CaptureFact, Degraded, EngineSession};
use noter_protocol::ipc::{Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::notify::{Notification, NotificationKind};
use crate::Core;

fn main_ctx() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    }
}

impl Core {
    /// At core start: calls left recording or paused were cut by a quit or a crash. The newest
    /// is offered **Resume Recording**; older ones end at their last audio.
    pub(crate) fn find_interrupted(&self) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-find-interrupted
        let cut: Vec<CallRef> = self.store().read(|c| {
            let mut stmt = c.prepare(
                "SELECT id, title, started_at, call_type FROM calls
                 WHERE status IN ('recording', 'paused') ORDER BY started_at DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(CallRef {
                    id: CallId::new(r.get::<_, String>(0)?),
                    title: r.get(1)?,
                    started_at: TimestampMs(r.get(2)?),
                    call_type: CallTypeId(r.get(3)?),
                })
            })?;
            rows.collect()
        })?;
        let Some((newest, older)) = cut.split_first() else {
            return Ok(());
        };
        for call in older {
            self.end_interrupted(&call.id)?;
        }
        let mut banners = self.app().banners.banners.clone();
        banners.retain(|b| b.kind() != BannerKind::RecordingInterruptedByQuit);
        banners.push(AppBanner::RecordingInterruptedByQuit {
            call: newest.clone(),
        });
        self.set_banners(banners);
        // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-find-interrupted
        Ok(())
    }

    /// The call the interrupted banner offers to resume, if it shows.
    pub(crate) fn interrupted_banner(&self) -> Option<CallRef> {
        self.app().banners.banners.iter().find_map(|b| match b {
            AppBanner::RecordingInterruptedByQuit { call } => Some(call.clone()),
            _ => None,
        })
    }

    /// Takes the interrupted banner down and ends its call: another capture started, or the
    /// user dismissed it.
    pub(crate) fn drop_interrupted(&self) -> Result<(), CoreError> {
        let Some(call) = self.interrupted_banner() else {
            return Ok(());
        };
        self.end_interrupted(&call.id)?;
        let mut banners = self.app().banners.banners.clone();
        banners.retain(|b| b.kind() != BannerKind::RecordingInterruptedByQuit);
        self.set_banners(banners);
        Ok(())
    }

    /// A cut call ends at its last audio and goes to processing (a banner may name a call
    /// that is gone).
    fn end_interrupted(&self, call_id: &CallId) -> Result<(), CoreError> {
        let Some((started_at, last)) = self.last_audio(call_id)? else {
            return Ok(());
        };
        let values = vec![
            ("status", json!("processing")),
            ("ended_at", json!(started_at + last)),
        ];
        self.write_call(
            &main_ctx(),
            call_id,
            "Ended interrupted recording",
            false,
            values,
        )
    }

    /// The call's start and the offset of the last audio it kept (segments, marks, gaps).
    fn last_audio(&self, call_id: &CallId) -> Result<Option<(i64, i64)>, CoreError> {
        let id = call_id.as_str().to_string();
        self.store().read(move |c| {
            c.query_row(
                "SELECT started_at, MAX(
                   COALESCE((SELECT MAX(t1_ms) FROM segments WHERE call_id = ?1), 0),
                   COALESCE((SELECT MAX(at_ms) FROM marks WHERE call_id = ?1), 0),
                   COALESCE((SELECT MAX(t1_ms) FROM gaps WHERE call_id = ?1), 0))
                 FROM calls WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })
    }

    // @cpt-flow:cpt-noter-flow-core-capture-session-resume:p1
    pub(crate) async fn resume_interrupted(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-resume-call
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let now = self.deps.clock.now().0;
        let call_id = args.call_id;
        // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-resume-call
        let banner = self.interrupted_banner().filter(|c| c.id == call_id);
        let idle = matches!(state.phase, CapturePhase::Idle | CapturePhase::Stopped);
        let cut = match banner.filter(|_| idle) {
            Some(call) => self.last_audio(&call_id)?.map(|audio| (call, audio)),
            None => None,
        };
        if let Some((call, (started_at, last))) = cut {
            // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-resume-interrupted
            // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-resume-interrupted
            let t1 = now - started_at;
            self.insert_gap(&call_id, last, t1, GapReason::Interrupted)?;
            *session = session.restart(started_at);
            session.away_ms = t1 - last;
            let mut banners = self.app().banners.banners.clone();
            banners.retain(|b| b.kind() != BannerKind::RecordingInterruptedByQuit);
            self.set_banners(banners);
            let status = vec![("status", json!("recording"))];
            self.write_call(ctx, &call_id, "Resumed recording", false, status)?;
            let id = call_id.as_str().to_string();
            let (class, not_stored): (String, bool) = self.store().read(move |c| {
                c.query_row(
                    "SELECT privacy_class, audio_not_stored FROM calls WHERE id = ?1",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
            })?;
            let start = self.session_for(&call_id, Some(t1))?;
            let recorded = session.recorded(now, None);
            self.set_capture(|c| {
                *c = CaptureState {
                    version: c.version,
                    phase: CapturePhase::Recording,
                    call_id: Some(call_id.clone()),
                    title: Some(call.title),
                    started_at: Some(call.started_at),
                    recorded_ms: recorded,
                    sensitive: class == "sensitive",
                    pause: None,
                    notice: None,
                    continue_until: None,
                    output_route: c.output_route,
                    replay_available: c.replay_available,
                    audio_not_stored: not_stored,
                    audio_writing: !not_stored,
                }
            });
            self.listen_for_speech(&mut session);
            session.engine_base = None;
            if self.engine.start_session(start).await.is_err() {
                session.failed_at = Some(now);
                return Ok(self.set_capture(|c| c.phase = CapturePhase::Failed));
            }
            // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-resume-interrupted
            // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-resume-interrupted
            return Ok(self.capture_now());
        }
        // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-else-expired
        if state.phase != CapturePhase::Failed || state.call_id.as_ref() != Some(&call_id) {
            return Err(CoreError::new(
                ErrorCode::NoticeExpired,
                "no interrupted call to resume",
            ));
        }
        // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-else-expired
        // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-try-again
        // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-try-again
        let failed_at = session.failed_at.unwrap_or(now);
        let (t0, t1) = (session.offset(failed_at), session.offset(now));
        // The engine still cannot start: the phase stays failed.
        if self.engine.session() == EngineSession::Failed {
            // The supervisor restarts its session and reports the `engine_restart` gap itself.
            self.engine.try_again().await?;
        } else {
            let start = self.session_for(&call_id, Some(t1))?;
            session.engine_base = None;
            self.engine.start_session(start).await?;
            self.insert_gap(&call_id, t0, t1, GapReason::EngineRestart)?;
        }
        session.away_ms += now - failed_at;
        session.failed_at = None;
        let recorded = session.recorded(now, None);
        self.set_capture(|c| {
            c.phase = CapturePhase::Recording;
            c.recorded_ms = recorded;
        });
        self.listen_for_speech(&mut session);
        // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-try-again
        // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-try-again
        // @cpt-begin:cpt-noter-flow-core-capture-session-resume:p1:inst-return-resume
        Ok(self.capture_now())
        // @cpt-end:cpt-noter-flow-core-capture-session-resume:p1:inst-return-resume
    }

    // @cpt-algo:cpt-noter-algo-core-capture-session-degraded:p1
    // @cpt-dod:cpt-noter-dod-core-capture-session-recovery:p1
    /// A supervisor fact about the live call: its gap rows and the capture rows of the
    /// degraded set; a capture that cannot be restarted fails the call.
    pub(crate) async fn capture_fact(&self, fact: CaptureFact) {
        let mut session = self.capture.lock().await;
        let state = self.capture_now();
        let base = session.engine_base.unwrap_or(0);
        let ours = |call_id: &CallId| {
            state.call_id.as_ref() == Some(call_id)
                && !matches!(state.phase, CapturePhase::Idle | CapturePhase::Stopped)
        };
        match fact {
            CaptureFact::Gap(gap) if ours(&gap.call_id) => {
                // @cpt-begin:cpt-noter-algo-core-capture-session-degraded:p1:inst-write-gaps
                let (t0, t1) = (base + i64::from(gap.t0_ms.0), base + i64::from(gap.t1_ms.0));
                if let Err(e) = self.insert_gap(&gap.call_id, t0, t1, gap.reason) {
                    self.log(crate::object(json!({
                        "level": "error", "module": "capture", "code": e.code
                    })));
                }
                // @cpt-end:cpt-noter-algo-core-capture-session-degraded:p1:inst-write-gaps
            }
            CaptureFact::Degraded {
                call_id,
                state: degraded,
                since_ms,
            } if ours(&call_id) => {
                // @cpt-begin:cpt-noter-algo-core-capture-session-degraded:p1:inst-publish-engine-states
                let since = TimestampMs(session.at(base + i64::from(since_ms.0)));
                let failed = degraded == Degraded::CaptureFailed;
                let new = degraded_state(&call_id, degraded, since);
                // @cpt-end:cpt-noter-algo-core-capture-session-degraded:p1:inst-publish-engine-states
                // @cpt-begin:cpt-noter-algo-core-capture-session-degraded:p1:inst-degraded-return
                let mut fresh = true;
                self.edit_degraded(|states| {
                    fresh = !states.iter().any(|s| same_kind(s, &new));
                    states.retain(|s| !same_kind(s, &new));
                    states.push(new.clone());
                });
                // @cpt-end:cpt-noter-algo-core-capture-session-degraded:p1:inst-degraded-return
                if failed {
                    // @cpt-begin:cpt-noter-state-core-capture-session-phase:p1:inst-st-failed
                    session.failed_at = Some(self.deps.clock.now().0);
                    self.set_capture(|c| c.phase = CapturePhase::Failed);
                    // @cpt-end:cpt-noter-state-core-capture-session-phase:p1:inst-st-failed
                }
                drop(session);
                let nt3 = matches!(
                    new,
                    DegradedState::SystemAudioSilent { .. }
                        | DegradedState::MicrophoneOff { .. }
                        | DegradedState::CaptureFailed { .. }
                );
                if fresh && nt3 {
                    self.notify(Notification {
                        call_id,
                        kind: NotificationKind::CaptureProblem(new),
                    });
                }
            }
            CaptureFact::Cleared {
                call_id,
                state: degraded,
            } if state.call_id.as_ref() == Some(&call_id) => {
                let gone = degraded_state(&call_id, degraded, TimestampMs(0));
                self.edit_degraded(|states| states.retain(|s| !same_kind(s, &gone)));
            }
            _ => {}
        }
    }

    /// The engine's states of a call that ended: none outlives it (a failed engine never
    /// clears its own).
    pub(crate) fn clear_engine_states(&self) {
        self.edit_degraded(|states| {
            states.retain(|s| {
                !matches!(
                    s,
                    DegradedState::MicrophoneOff { .. }
                        | DegradedState::SystemAudioSilent { .. }
                        | DegradedState::TranscriptionStalled { .. }
                        | DegradedState::DeviceChanged { .. }
                        | DegradedState::CaptureFailed { .. }
                )
            })
        });
    }
}

fn same_kind(a: &DegradedState, b: &DegradedState) -> bool {
    std::mem::discriminant(a) == std::mem::discriminant(b)
}

/// The supervisor's degraded state as the degraded set carries it.
fn degraded_state(call_id: &CallId, state: Degraded, since: TimestampMs) -> DegradedState {
    let call_id = call_id.clone();
    match state {
        Degraded::TranscriptionStalled => DegradedState::TranscriptionStalled { call_id, since },
        Degraded::SystemAudioSilent { confidence } => DegradedState::SystemAudioSilent {
            call_id,
            since,
            confidence,
        },
        Degraded::MicrophoneOff => DegradedState::MicrophoneOff { call_id },
        Degraded::DeviceChanged {
            device_name,
            gap_ms,
        } => DegradedState::DeviceChanged {
            call_id,
            device_name,
            gap_ms: DurationMs(gap_ms),
        },
        Degraded::CaptureFailed => DegradedState::CaptureFailed { call_id, since },
    }
}
