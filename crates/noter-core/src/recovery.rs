//! Recovery after a quit, a crash or an engine failure (`cpt-noter-flow-core-capture-session-resume`)
//! and the disk rows of `degraded:changed` (`cpt-noter-algo-core-capture-session-degraded`).

use noter_db::rusqlite::OptionalExtension;
use noter_protocol::engine::EngineCommand;
use noter_protocol::ipc::{Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

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
            if self
                .engine
                .command(EngineCommand::StartSession(start))
                .await
                .is_err()
            {
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
        let start = self.session_for(&call_id, Some(t1))?;
        // The engine still cannot start: the phase stays failed.
        self.engine
            .command(EngineCommand::StartSession(start))
            .await?;
        self.insert_gap(&call_id, t0, t1, GapReason::EngineRestart)?;
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
}
