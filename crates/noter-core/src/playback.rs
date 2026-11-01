//! Replay (`cpt-noter-flow-core-live-transcript-replay`): the engine plays the audio, the core
//! decides whether it may. During capture only headphones are allowed, because the meeting app
//! captures the microphone itself and would send the replay into the call (owner decision of
//! 17 Oct); `playback:state` goes out whole with its own version.

use std::sync::{Arc, Mutex};

use noter_engine_client::CommandError;
use noter_protocol::engine::{EngineCommand, EngineEvent};
use noter_protocol::ipc::event_names;
use noter_protocol::model::*;
use noter_protocol::*;
use tokio::sync::broadcast::error::RecvError;

use crate::app::WholeState;
use crate::{lock, Core};

impl WholeState for PlaybackState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

/// The playback state machine's one slice, owned by [`Core`].
pub(crate) struct Playback(Mutex<PlaybackState>);

impl Playback {
    pub(crate) fn new() -> Self {
        Self(Mutex::new(PlaybackState {
            version: StateVersion(0),
            playing: false,
            call_id: None,
            position_ms: OffsetMs(0),
            to_ms: None,
            route: OutputRoute::Unknown,
            stopped_reason: None,
        }))
    }
}

/// What `audio_play` needs to know of the call and of the captures running now.
struct Playable {
    audio: bool,
    capturing: bool,
}

// @cpt-algo:cpt-noter-algo-core-live-transcript-replay-route:p1
/// Allowed, or the refusing error code.
fn replay_route(
    capturing: bool,
    route: OutputRoute,
    exclude_own_sounds: bool,
) -> Result<(), CoreError> {
    // @cpt-begin:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-no-capture
    if !capturing {
        return Ok(());
    }
    // @cpt-end:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-no-capture
    // @cpt-begin:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-speakers
    // @cpt-begin:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-unknown
    // An unidentified output the user marked as headphones already reads as `Headphones`.
    match route {
        OutputRoute::Speakers => Err(CoreError::new(
            ErrorCode::ReplayNeedsHeadphones,
            "Recording on speakers",
        )),
        OutputRoute::Unknown => Err(CoreError::new(
            ErrorCode::OutputRouteUnknown,
            "The output is not known to be headphones",
        )),
        OutputRoute::Headphones => Ok(()),
    }?;
    // @cpt-end:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-unknown
    // @cpt-end:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-speakers
    // @cpt-begin:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-own-sounds
    if !exclude_own_sounds {
        return Err(CoreError::new(
            ErrorCode::OwnSoundsNotExcluded,
            "Own sounds are not excluded from the recording",
        ));
    }
    // @cpt-end:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-own-sounds
    // @cpt-begin:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-route-allowed
    Ok(())
    // @cpt-end:cpt-noter-algo-core-live-transcript-replay-route:p1:inst-route-allowed
}

impl Core {
    /// Listens for the engine's playback position and for a capture starting.
    pub(crate) fn start_playback(self: &Arc<Self>) {
        let mut events = self.engine.events();
        let weak = Arc::downgrade(self);
        self.spawn(async move {
            loop {
                let line = match events.recv().await {
                    Ok(line) => line,
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return,
                };
                let Some(core) = weak.upgrade() else { return };
                match line.event {
                    EngineEvent::PlaybackPosition {
                        call_id,
                        at_ms,
                        playing,
                    } => core.playback_position(&call_id, at_ms, playing),
                    EngineEvent::SessionStarted { .. } => {
                        core.stop_playback(PlaybackStopReason::CaptureStarted);
                    }
                    _ => {}
                }
            }
        });
    }

    // @cpt-flow:cpt-noter-flow-core-live-transcript-replay:p1
    // @cpt-dod:cpt-noter-dod-core-live-transcript-replay:p1
    pub(crate) async fn play_audio(&self, args: PlayAudioArgs) -> Result<PlaybackState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-play-call
        let id = args.call_id.clone();
        // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-play-call
        let found = self.store.read(|c| {
            use noter_db::rusqlite::OptionalExtension;
            c.query_row(
                "SELECT audio_deleted = 0 AND audio_not_stored = 0,
                        EXISTS (SELECT 1 FROM calls WHERE status IN ('recording', 'paused'))
                 FROM calls WHERE id = ?1",
                [id.as_str()],
                |r| {
                    Ok(Playable {
                        audio: r.get(0)?,
                        capturing: r.get(1)?,
                    })
                },
            )
            .optional()
        })?;
        // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-if-no-audio
        let playable = found.ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no such call"))?;
        if !playable.audio {
            return Err(CoreError::new(
                ErrorCode::AudioDeleted,
                "the audio of this call is gone",
            ));
        }
        // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-if-no-audio
        // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-route-check
        let route = self.app().environment.output_route;
        let exclude_own = lock(&self.settings).audio.exclude_own_sounds;
        replay_route(playable.capturing, route, exclude_own)?;
        // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-route-check
        // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-engine-play
        self.engine
            .command(EngineCommand::Play {
                call_id: args.call_id.clone(),
                from_ms: args.from_ms,
                to_ms: args.to_ms,
                channel: args.channel,
            })
            .await
            .map_err(CoreError::from)?;
        // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-engine-play
        // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-play-return
        // @cpt-begin:cpt-noter-state-core-live-transcript-playback:p1:inst-st-play
        // @cpt-begin:cpt-noter-state-core-live-transcript-playback:p1:inst-st-replay
        let mut state = lock(&self.playback.0);
        state.playing = true;
        state.call_id = Some(args.call_id);
        state.position_ms = args.from_ms;
        state.to_ms = args.to_ms;
        state.route = route;
        state.stopped_reason = None;
        Ok(self.publish(event_names::PLAYBACK_STATE, &mut *state))
        // @cpt-end:cpt-noter-state-core-live-transcript-playback:p1:inst-st-replay
        // @cpt-end:cpt-noter-state-core-live-transcript-playback:p1:inst-st-play
        // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-play-return
    }

    // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-stop-replay
    pub(crate) async fn stop_audio(&self) -> Result<PlaybackState, CoreError> {
        if !lock(&self.playback.0).playing {
            return Ok(lock(&self.playback.0).clone());
        }
        // The engine may be gone already; the user's stop still counts.
        match self.engine.command(EngineCommand::StopPlayback).await {
            Ok(()) | Err(CommandError::Unavailable) => {}
            Err(e) => return Err(e.into()),
        }
        let mut state = lock(&self.playback.0);
        if state.playing {
            state.playing = false;
            state.stopped_reason = Some(PlaybackStopReason::User);
            return Ok(self.publish(event_names::PLAYBACK_STATE, &mut *state));
        }
        Ok(state.clone())
    }
    // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-stop-replay

    // @cpt-begin:cpt-noter-flow-core-live-transcript-replay:p1:inst-playback-events
    fn playback_position(&self, call_id: &CallId, at_ms: OffsetMs, playing: bool) {
        let mut state = lock(&self.playback.0);
        if !state.playing || state.call_id.as_ref() != Some(call_id) {
            return;
        }
        state.position_ms = at_ms;
        if !playing {
            // @cpt-begin:cpt-noter-state-core-live-transcript-playback:p1:inst-st-stop
            state.playing = false;
            state.stopped_reason = Some(PlaybackStopReason::Ended);
            // @cpt-end:cpt-noter-state-core-live-transcript-playback:p1:inst-st-stop
        }
        self.publish(event_names::PLAYBACK_STATE, &mut *state);
    }
    // @cpt-end:cpt-noter-flow-core-live-transcript-replay:p1:inst-playback-events

    /// Playback stops for a reason of the core's own, and the engine is told to stop playing.
    /// Ends a replay of `call_id` (its audio is about to go); one of another call plays on.
    pub(crate) fn stop_playback_of(&self, call_id: &CallId) {
        if lock(&self.playback.0).call_id.as_ref() == Some(call_id) {
            self.stop_playback(PlaybackStopReason::User);
        }
    }

    fn stop_playback(&self, reason: PlaybackStopReason) {
        let mut state = lock(&self.playback.0);
        if !state.playing {
            return;
        }
        state.playing = false;
        state.stopped_reason = Some(reason);
        self.publish(event_names::PLAYBACK_STATE, &mut *state);
        drop(state);
        if let Some(core) = self.this() {
            self.spawn(async move {
                let _ = core.engine.command(EngineCommand::StopPlayback).await;
            });
        }
    }

    /// The output changed (the caller holds the app lock): a replay that runs during capture
    /// ends when the output becomes speakers. Takes no lock but the playback slice's and a
    /// database read.
    pub(crate) fn playback_route_changed(&self, route: OutputRoute) {
        if route != OutputRoute::Speakers || !lock(&self.playback.0).playing {
            return;
        }
        let capturing = self
            .store
            .read(|c| {
                c.query_row(
                    "SELECT EXISTS (SELECT 1 FROM calls WHERE status IN ('recording', 'paused'))",
                    [],
                    |r| r.get::<_, bool>(0),
                )
            })
            .unwrap_or(false);
        if capturing {
            self.stop_playback(PlaybackStopReason::OutputSwitchedToSpeakers);
        }
    }
}
