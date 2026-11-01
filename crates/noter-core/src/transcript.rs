//! The live transcript (`cpt-noter-feature-core-live-transcript`): hypotheses go to the stream hub
//! and never to the database; confirmed segments are batched for at most 250 ms, committed with
//! `Store::insert_batch` (no change rows, TL-1) and published only after the commit; live speakers
//! become `speakers` rows; `transcript_subscribe`, `levels_subscribe` and `transcript_span` answer
//! from here. The capture session writes gap and mark rows and calls [`Core::publish_gap`],
//! [`Core::publish_mark`] and [`Core::call_ended`]; this service never writes `calls`.
//!
//! Lock order: `State`, then a hub's lock (a subscription and every publish take them in that
//! order, so a snapshot and `last_seq` always agree). Neither is held across a writer job.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::Insert;
use noter_protocol::engine::{EngineEvent, EngineEventLine, EngineSegment, EngineSegmentState};
use noter_protocol::ipc::{CommandCtx, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;

use crate::capture::CaptureEvent;
use crate::hub::{StreamHub, StreamMsg};
use crate::{internal, lock, object, to_json, Core};

/// A batch is committed this long after its first row at the latest.
const BATCH: Duration = Duration::from_millis(250);
/// Levels reach a window at most this often (the hub coalesces).
const LEVELS_EVERY_MS: i64 = 100;

impl StreamMsg for TranscriptMsg {
    fn set_seq(&mut self, seq: Seq) {
        self.seq = seq;
    }
    fn ended(reason: StreamEndReason) -> Option<Self> {
        Some(TranscriptMsg {
            seq: Seq(0),
            event: TranscriptEvent::Ended { reason },
        })
    }
}

impl StreamMsg for LevelsMsg {
    fn set_seq(&mut self, seq: Seq) {
        self.seq = seq;
    }
    fn ended(_: StreamEndReason) -> Option<Self> {
        None
    }
}

/// The transcript service's state, owned by [`Core`].
pub(crate) struct Transcript {
    /// The data folder: `transcript.jsonl` goes to `audio/<call_id>/` in it.
    dir: PathBuf,
    hub: OnceLock<Arc<StreamHub<TranscriptMsg>>>,
    levels: OnceLock<Arc<StreamHub<LevelsMsg>>>,
    state: Mutex<State>,
}

impl Transcript {
    pub(crate) fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            hub: OnceLock::new(),
            levels: OnceLock::new(),
            state: Mutex::new(State::default()),
        }
    }

    /// Test hook (`testing`): the next commit "crashes" before it publishes.
    #[cfg(feature = "harness")]
    pub(crate) fn fail_after_commit_once(&self) {
        lock(&self.state).fail_after_commit = true;
    }
}

#[derive(Default)]
struct State {
    calls: HashMap<CallId, Live>,
    /// When the first levels of a stream arrived: `LevelsMsg.at_ms` counts from it.
    levels_origin: HashMap<String, i64>,
    /// Test hook state (D-27): not compiled into a release build.
    #[cfg(feature = "harness")]
    fail_after_commit: bool,
    #[cfg(feature = "harness")]
    crashed: bool,
}

/// A call that is capturing: what is not in the database yet, or not published yet.
#[derive(Default)]
struct Live {
    /// The current hypothesis per channel (at most two).
    hypotheses: Vec<SegmentView>,
    speakers: HashMap<(AudioChannel, String), SpeakerView>,
    /// The open batch: new speakers, then the segments that name them.
    rows: Vec<Insert>,
    open: Vec<SegmentView>,
    /// Committed (or committing) but not published: a snapshot leaves them out, the stream
    /// delivers them, so nothing shows twice.
    unpublished: HashSet<SegmentId>,
    timer: bool,
}

impl Core {
    fn transcript_hub(&self) -> Arc<StreamHub<TranscriptMsg>> {
        self.transcript
            .hub
            .get_or_init(|| self.stream_hub(None))
            .clone()
    }

    fn levels_hub(&self) -> Arc<StreamHub<LevelsMsg>> {
        self.transcript
            .levels
            .get_or_init(|| self.stream_hub(Some(LEVELS_EVERY_MS)))
            .clone()
    }

    /// Starts listening to the engine's events; the host calls it once, after `start_first_run`
    /// has set the core's handle.
    pub(crate) fn start_transcript(self: &Arc<Self>) {
        // The session writes marks and gaps and ends the stream: it tells the transcript after
        // its commit.
        let session = Arc::downgrade(self);
        self.on_capture_event(move |event| {
            let Some(core) = session.upgrade() else {
                return;
            };
            match event.clone() {
                CaptureEvent::Mark(mark) => core.publish_mark(mark),
                CaptureEvent::Gap(gap) => core.publish_gap(gap),
                CaptureEvent::Stopped { call_id, reason } => core.call_ended(&call_id, reason),
            }
        });
        let mut events = self.engine.events();
        let weak = Arc::downgrade(self);
        self.spawn(async move {
            loop {
                let line = match events.recv().await {
                    Ok(line) => line,
                    // Levels may drop; the engine client's counters show the rest.
                    Err(RecvError::Lagged(_)) => continue,
                    Err(RecvError::Closed) => return,
                };
                let Some(core) = weak.upgrade() else { return };
                core.on_engine_event(line);
            }
        });
    }

    fn on_engine_event(&self, line: EngineEventLine) {
        match line.event {
            EngineEvent::Segment { segment } => self.on_segment(segment),
            EngineEvent::SpeakerTurn {
                call_id,
                channel,
                speaker_label,
                ..
            } => self.on_speaker_turn(&call_id, channel, &speaker_label),
            EngineEvent::Levels {
                call_id,
                mic_db,
                sys_db,
            } => self.on_levels(call_id, mic_db, sys_db, line.at),
            EngineEvent::SessionStopped { call_id, .. } => {
                self.call_ended(&call_id, StreamEndReason::CallStopped)
            }
            _ => {}
        }
    }

    // @cpt-dod:cpt-noter-dod-core-live-transcript-persist:p1
    // @cpt-algo:cpt-noter-algo-core-live-transcript-batch:p1
    // @cpt-state:cpt-noter-state-core-live-transcript-segment:p1
    fn on_segment(&self, seg: EngineSegment) {
        let mut state = lock(&self.transcript.state);
        #[cfg(feature = "harness")]
        if state.crashed {
            return;
        }
        let call_id = seg.call_id.clone();
        let live = match self.live(&mut state, &call_id) {
            Ok(live) => live,
            Err(e) => return self.log_error("segment", &e),
        };
        let speaker = live.speaker(&call_id, seg.channel, &seg.speaker_label);
        let hypothesis = seg.state == EngineSegmentState::Hypothesis;
        // A hypothesis keeps the engine's id; the core assigns the `seg_` id at confirmation.
        let id = if hypothesis {
            SegmentId::new(seg.id.clone())
        } else {
            SegmentId::new(format!("seg_{}", ulid::Ulid::generate()))
        };
        let view = segment_view(&seg, id, speaker);
        // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-if-hypothesis
        if hypothesis {
            // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-hypothesis
            // @cpt-begin:cpt-noter-state-core-live-transcript-segment:p1:inst-st-replace
            live.hypotheses.retain(|h| h.channel != seg.channel);
            live.hypotheses.push(view.clone());
            // @cpt-end:cpt-noter-state-core-live-transcript-segment:p1:inst-st-replace
            self.transcript_hub().publish(
                call_id.as_str(),
                TranscriptMsg {
                    seq: Seq(0),
                    event: TranscriptEvent::Hypothesis { segment: view },
                },
            );
            // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-hypothesis
        } else {
            // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-if-hypothesis
            // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-add-confirmed
            live.rows.push(segment_row(&seg, &view));
            live.open.push(view);
            // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-add-confirmed
        }
        // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-return-batch
        self.arm(&call_id, live);
        // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-return-batch
    }

    // @cpt-algo:cpt-noter-algo-core-live-transcript-speakers:p1
    fn on_speaker_turn(&self, call_id: &CallId, channel: AudioChannel, label: &str) {
        let mut state = lock(&self.transcript.state);
        #[cfg(feature = "harness")]
        if state.crashed {
            return;
        }
        match self.live(&mut state, call_id) {
            Ok(live) => {
                live.speaker(call_id, channel, label);
                self.arm(call_id, live);
            }
            Err(e) => self.log_error("speaker", &e),
        }
    }

    fn on_levels(&self, call_id: Option<CallId>, mic_db: f32, sys_db: f32, at: TimestampMs) {
        // @cpt-begin:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-forward
        let key = call_id.as_ref().map_or("", CallId::as_str);
        let origin = *lock(&self.transcript.state)
            .levels_origin
            .entry(key.to_owned())
            .or_insert(at.0);
        self.levels_hub().publish(
            key,
            LevelsMsg {
                seq: Seq(0),
                at_ms: OffsetMs((at.0 - origin).clamp(0, i64::from(u32::MAX)) as u32),
                mic_db,
                sys_db,
            },
        );
        // @cpt-end:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-forward
    }

    /// How many speakers the capturing call has so far (the menu bar's second line).
    pub(crate) fn live_speakers(&self, call_id: &CallId) -> usize {
        lock(&self.transcript.state)
            .calls
            .get(call_id)
            .map_or(0, |live| live.speakers.len())
    }

    /// The state of a call that captures, loaded from its stored speakers the first time.
    fn live<'a>(&self, state: &'a mut State, call_id: &CallId) -> Result<&'a mut Live, CoreError> {
        if !state.calls.contains_key(call_id) {
            let speakers = self.store.read(|c| speakers_of(c, call_id))?;
            let live = Live {
                speakers: speakers
                    .into_iter()
                    .map(|(label, s)| ((s.channel, label), s))
                    .collect(),
                ..Live::default()
            };
            state.calls.insert(call_id.clone(), live);
        }
        Ok(state.calls.get_mut(call_id).expect("inserted above"))
    }

    /// Commits the open batch 250 ms after its first row, on tokio time (TL-4).
    fn arm(&self, call_id: &CallId, live: &mut Live) {
        if live.timer || live.rows.is_empty() {
            return;
        }
        let Some(core) = self.this() else { return };
        live.timer = true;
        let call_id = call_id.clone();
        self.spawn(async move {
            tokio::time::sleep(BATCH).await;
            core.flush(&call_id);
        });
    }

    /// Commits the open batch in one writer transaction, then publishes `confirmed` for each
    /// segment in order; the publish removes the hypothesis it confirms. A failed commit keeps
    /// the batch for the next flush.
    // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-commit-batch
    fn flush(&self, call_id: &CallId) {
        let (rows, segments) = {
            let mut state = lock(&self.transcript.state);
            let Some(live) = state.calls.get_mut(call_id) else {
                return;
            };
            live.timer = false;
            if live.rows.is_empty() {
                return;
            }
            let segments = std::mem::take(&mut live.open);
            live.unpublished
                .extend(segments.iter().map(|s| s.id.clone()));
            (std::mem::take(&mut live.rows), segments)
        };
        let committed = self.store.insert_batch(rows.clone());
        // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-commit-batch
        let mut state = lock(&self.transcript.state);
        #[cfg(feature = "harness")]
        {
            let crash = std::mem::take(&mut state.fail_after_commit);
            if crash && committed.is_ok() {
                // The test hook: the core dies between the commit and the publish.
                state.crashed = true;
                return;
            }
        }
        let Some(live) = state.calls.get_mut(call_id) else {
            return;
        };
        if let Err(e) = committed {
            for s in &segments {
                live.unpublished.remove(&s.id);
            }
            live.rows.splice(0..0, rows);
            live.open.splice(0..0, segments);
            self.arm(call_id, live);
            return self.log_error("commit", &e);
        }
        // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-confirmed
        // @cpt-begin:cpt-noter-state-core-live-transcript-segment:p1:inst-st-confirm
        let hub = self.transcript_hub();
        for segment in segments {
            live.hypotheses
                .retain(|h| h.channel != segment.channel || h.t0_ms >= segment.t1_ms);
            live.unpublished.remove(&segment.id);
            hub.publish(
                call_id.as_str(),
                TranscriptMsg {
                    seq: Seq(0),
                    event: TranscriptEvent::Confirmed { segment },
                },
            );
        }
        // @cpt-end:cpt-noter-state-core-live-transcript-segment:p1:inst-st-confirm
        // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-confirmed
    }

    /// A gap the session wrote: its subscribers hear it.
    // @cpt-begin:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-gap-mark
    pub(crate) fn publish_gap(&self, gap: GapView) {
        let key = gap.call_id.clone();
        self.publish_event(&key, TranscriptEvent::Gap { gap });
    }

    /// A mark the session wrote: its subscribers hear it.
    pub(crate) fn publish_mark(&self, mark: MarkView) {
        let key = mark.call_id.clone();
        self.publish_event(&key, TranscriptEvent::Mark { mark });
    }
    // @cpt-end:cpt-noter-algo-core-live-transcript-batch:p1:inst-publish-gap-mark

    fn publish_event(&self, call_id: &CallId, event: TranscriptEvent) {
        // Under the state lock like every publish, so a snapshot never falls between two.
        let _state = lock(&self.transcript.state);
        // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-deliver
        self.transcript_hub()
            .publish(call_id.as_str(), TranscriptMsg { seq: Seq(0), event });
        // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-deliver
    }

    /// The call ended (`CallStopped`) or was thrown away (`Discarded`): the last batch commits,
    /// `transcript.jsonl` is written for a stop, and every subscription ends with the reason.
    /// Idempotent: the engine's `session_stopped` and the session's own call both land here.
    // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-end-stream
    /// Ends the live stream only (a lagged subscriber resubscribes); the call goes on.
    #[cfg(feature = "harness")]
    pub(crate) fn end_transcript_stream(&self, call_id: &CallId, reason: StreamEndReason) {
        self.transcript_hub().end_stream(call_id.as_str(), reason);
    }

    pub(crate) fn call_ended(&self, call_id: &CallId, reason: StreamEndReason) {
        if reason != StreamEndReason::Discarded {
            // @cpt-begin:cpt-noter-algo-core-live-transcript-file:p2:inst-file-flush
            self.flush(call_id);
            // @cpt-end:cpt-noter-algo-core-live-transcript-file:p2:inst-file-flush
            // The post-call job moves the call on from processing once its outputs are written.
            if let Err(e) = self.write_transcript_file(call_id) {
                self.log_error("file", &e);
            }
        }
        lock(&self.transcript.state).calls.remove(call_id);
        self.transcript_hub().end_stream(call_id.as_str(), reason);
    }
    // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-end-stream

    /// `audio/<call_id>/transcript.jsonl`, 0600: a temporary file renamed into place.
    // @cpt-dod:cpt-noter-dod-core-live-transcript-span-file:p2
    // @cpt-algo:cpt-noter-algo-core-live-transcript-file:p2
    pub(crate) fn write_transcript_file(&self, call_id: &CallId) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-algo-core-live-transcript-file:p2:inst-file-write
        let segments = self.store.read(|c| segments_of(c, call_id, None))?;
        let dir = self.transcript.dir.join("audio").join(call_id.as_str());
        std::fs::create_dir_all(&dir).map_err(internal)?;
        let tmp = dir.join("transcript.jsonl.tmp");
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(internal)?;
        for segment in &segments {
            writeln!(file, "{}", to_json(segment)).map_err(internal)?;
        }
        file.sync_all().map_err(internal)?;
        // @cpt-begin:cpt-noter-algo-core-live-transcript-file:p2:inst-file-return
        std::fs::rename(&tmp, dir.join("transcript.jsonl")).map_err(internal)
        // @cpt-end:cpt-noter-algo-core-live-transcript-file:p2:inst-file-return
        // @cpt-end:cpt-noter-algo-core-live-transcript-file:p2:inst-file-write
    }

    fn log_error(&self, what: &str, e: &CoreError) {
        self.log(object(json!({
            "level": "error", "module": "transcript", "code": what, "message_len": e.message.len()
        })));
    }

    // @cpt-flow:cpt-noter-flow-core-live-transcript-subscribe:p1
    // @cpt-dod:cpt-noter-dod-core-live-transcript-stream:p1
    pub(crate) fn subscribe_transcript(
        &self,
        ctx: &CommandCtx,
        args: TranscriptSubscribeArgs,
        channel: Sink<TranscriptMsg>,
    ) -> Result<TranscriptSnapshot, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-subscribe-call
        let id = &args.call_id;
        // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-subscribe-call
        // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-if-unknown
        let call = self
            .store
            .read(|c| call_state(c, id))?
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no such call"))?;
        // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-if-unknown
        if !call.live {
            // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-return-snapshot
            let snapshot = self.snapshot(&args.call_id, &call, vec![], &HashSet::new())?;
            // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-return-snapshot
            // Nothing will stream: no subscription and no message (`subscription_id` is null).
            return Ok(snapshot);
        }
        // The state lock comes first: a commit that has not published yet is left out of the
        // snapshot and arrives on the Channel.
        let state = lock(&self.transcript.state);
        let (hypotheses, unpublished) = state.calls.get(&args.call_id).map_or_else(
            || (vec![], HashSet::new()),
            |l| (l.hypotheses.clone(), l.unpublished.clone()),
        );
        // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-snapshot
        let subscribed = self.subscribe(
            &self.transcript_hub(),
            args.call_id.as_str(),
            ctx,
            channel,
            || self.snapshot(&args.call_id, &call, hypotheses, &unpublished),
        )?;
        // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-snapshot
        drop(state);
        // @cpt-begin:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-return-snapshot
        Ok(TranscriptSnapshot {
            subscription_id: Some(subscribed.subscription_id),
            last_seq: subscribed.last_seq,
            ..subscribed.snapshot
        })
        // @cpt-end:cpt-noter-flow-core-live-transcript-subscribe:p1:inst-return-snapshot
    }

    /// Everything committed and published for the call, read on the writer connection.
    fn snapshot(
        &self,
        call_id: &CallId,
        call: &CallState,
        hypotheses: Vec<SegmentView>,
        unpublished: &HashSet<SegmentId>,
    ) -> Result<TranscriptSnapshot, CoreError> {
        let id = call_id.clone();
        let (mut segments, mut speakers, marks, gaps) = self.store.read_snapshot(move |c| {
            Ok((
                segments_of(c, &id, None)?,
                speakers_of(c, &id)?
                    .into_iter()
                    .map(|(_, s)| s)
                    .collect::<Vec<_>>(),
                marks_of(c, &id)?,
                gaps_of(c, &id)?,
            ))
        })?;
        segments.retain(|s| !unpublished.contains(&s.id));
        // A speaker a hypothesis names may not be committed yet.
        for h in &hypotheses {
            if !speakers.iter().any(|s| s.id == h.speaker.speaker_id) {
                speakers.push(speaker_view(call_id, &h.speaker, h.channel));
            }
        }
        let pass = segments.first().map_or(TranscriptPass::Live, |g| g.pass);
        for s in &mut speakers {
            s.segment_count = segments
                .iter()
                .filter(|g| g.speaker.speaker_id == s.id)
                .count() as u32;
            s.sample = (s.label != SpeakerLabel::You && pass == TranscriptPass::Live)
                .then(|| {
                    segments
                        .iter()
                        .filter(|g| g.speaker.speaker_id == s.id)
                        .min_by_key(|g| g.t0_ms)
                })
                .flatten()
                .map(|g| TimeSpan {
                    call_id: call_id.clone(),
                    channel: None,
                    t0_ms: g.t0_ms,
                    t1_ms: g.t1_ms,
                });
        }
        Ok(TranscriptSnapshot {
            subscription_id: None,
            call_id: call_id.clone(),
            live: call.live,
            pass,
            archive: call.archive,
            segments,
            hypotheses,
            marks,
            gaps,
            speakers,
            last_seq: Seq(0),
            audio_available: call.audio_available,
        })
    }

    // @cpt-flow:cpt-noter-flow-core-live-transcript-levels:p2
    pub(crate) fn subscribe_levels(
        &self,
        ctx: &CommandCtx,
        args: SubscribeLevelsArgs,
        channel: Sink<LevelsMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-call
        // @cpt-begin:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-end
        // The subscription ends with `stream_unsubscribe` or a webview reload: the core's hubs do it.
        // @cpt-begin:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-handle
        let key = args.call_id.as_ref().map_or("", CallId::as_str);
        let subscribed = self.subscribe(&self.levels_hub(), key, ctx, channel, || Ok(()))?;
        Ok(SubscriptionHandle {
            subscription_id: subscribed.subscription_id,
        })
        // @cpt-end:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-handle
        // @cpt-end:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-end
        // @cpt-end:cpt-noter-flow-core-live-transcript-levels:p2:inst-levels-call
    }

    // @cpt-flow:cpt-noter-flow-core-live-transcript-span:p2
    pub(crate) fn span_preview(&self, args: SpanArgs) -> Result<SpanPreview, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-live-transcript-span:p2:inst-span-call
        let span = args.span;
        // @cpt-end:cpt-noter-flow-core-live-transcript-span:p2:inst-span-call
        let call_id = span.call_id.clone();
        let found = self.store.read(|c| {
            let (Some(call), Some(state)) = (call_ref(c, &call_id)?, call_state(c, &call_id)?)
            else {
                return Ok(None);
            };
            // @cpt-begin:cpt-noter-flow-core-live-transcript-span:p2:inst-span-select
            let segments = segments_of(c, &call_id, Some((span.channel, span.t0_ms, span.t1_ms)))?;
            // @cpt-end:cpt-noter-flow-core-live-transcript-span:p2:inst-span-select
            Ok(Some((call, state.audio_available, segments)))
        })?;
        let (call, audio_available, segments) =
            found.ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no such call"))?;
        // @cpt-begin:cpt-noter-flow-core-live-transcript-span:p2:inst-span-return
        Ok(SpanPreview {
            span,
            call,
            segments,
            audio_available,
            upgraded_by_archive: false,
        })
        // @cpt-end:cpt-noter-flow-core-live-transcript-span:p2:inst-span-return
    }
}

/// What the snapshot needs of the `calls` row.
struct CallState {
    live: bool,
    archive: ArchiveStatus,
    audio_available: bool,
}

fn call_state(c: &Connection, id: &CallId) -> noter_db::rusqlite::Result<Option<CallState>> {
    c.query_row(
        "SELECT status, archive_status, audio_deleted, audio_not_stored FROM calls WHERE id = ?1",
        [id.as_str()],
        |r| {
            let status: String = r.get(0)?;
            let archive: String = r.get(1)?;
            let (deleted, not_stored): (i64, i64) = (r.get(2)?, r.get(3)?);
            Ok(CallState {
                live: status == "recording" || status == "paused",
                archive: word(&archive).unwrap_or(ArchiveStatus::NotStarted),
                audio_available: deleted == 0 && not_stored == 0,
            })
        },
    )
    .optional()
}

fn call_ref(c: &Connection, id: &CallId) -> noter_db::rusqlite::Result<Option<CallRef>> {
    c.query_row(
        "SELECT title, started_at, call_type FROM calls WHERE id = ?1",
        [id.as_str()],
        |r| {
            Ok(CallRef {
                id: id.clone(),
                title: r.get(0)?,
                started_at: TimestampMs(r.get(1)?),
                call_type: CallTypeId(r.get::<_, String>(2)?),
            })
        },
    )
    .optional()
}

/// The call's current-pass segments (archive once it exists, else live) in time order; `span` keeps those that overlap it.
pub(crate) fn segments_of(
    c: &Connection,
    call_id: &CallId,
    span: Option<(Option<AudioChannel>, OffsetMs, OffsetMs)>,
) -> noter_db::rusqlite::Result<Vec<SegmentView>> {
    let mut stmt = c.prepare(
        "SELECT s.id, s.channel, s.t0_ms, s.t1_ms, s.text, s.lang, s.lang_p, s.avg_logprob,
                p.id, p.label, p.n, p.named_by, s.pass, p.person_id
         FROM segments s LEFT JOIN speakers p ON p.id = s.speaker_id
         WHERE s.call_id = ?1 AND s.pass = (CASE WHEN EXISTS
               (SELECT 1 FROM segments WHERE call_id = ?1 AND pass = 'archive')
               THEN 'archive' ELSE 'live' END)
         ORDER BY s.t0_ms, s.rowid",
    )?;
    let rows = stmt.query_map([call_id.as_str()], |r| {
        let channel: AudioChannel = word(&r.get::<_, String>(1)?).unwrap_or(AudioChannel::Mic);
        let label: Option<String> = r.get(9)?;
        let named_by: Option<String> = r.get(11)?;
        Ok(SegmentView {
            id: SegmentId::new(r.get::<_, String>(0)?),
            call_id: call_id.clone(),
            channel,
            speaker: SpeakerRef {
                speaker_id: SpeakerId::new(r.get::<_, Option<String>>(8)?.unwrap_or_default()),
                label: speaker_label(
                    channel,
                    label.as_deref().unwrap_or(""),
                    r.get(10)?,
                    named_by.as_deref(),
                    r.get::<_, Option<String>>(13)?,
                ),
            },
            crosstalk_with: vec![],
            t0_ms: OffsetMs(r.get(2)?),
            t1_ms: OffsetMs(r.get(3)?),
            text: r.get(4)?,
            lang: lang(&r.get::<_, Option<String>>(5)?.unwrap_or_default()),
            lang_p: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0) as f32,
            confidence: confidence(r.get::<_, Option<f64>>(7)?.unwrap_or(0.0) as f32),
            state: SegmentState::Confirmed,
            pass: if r.get::<_, String>(12)? == "archive" {
                TranscriptPass::Archive
            } else {
                TranscriptPass::Live
            },
            corrections: vec![],
        })
    })?;
    let mut all = rows.collect::<Result<Vec<_>, _>>()?;
    if let Some((channel, t0, t1)) = span {
        all.retain(|s| channel.map_or(true, |c| c == s.channel) && s.t1_ms > t0 && s.t0_ms < t1);
    }
    Ok(all)
}

/// The call's live speakers with the engine label each was created for.
fn speakers_of(
    c: &Connection,
    call_id: &CallId,
) -> noter_db::rusqlite::Result<Vec<(String, SpeakerView)>> {
    let mut stmt = c.prepare(
        "SELECT id, label, n, channel, named_by, person_id FROM speakers
         WHERE call_id = ?1 AND pass = (CASE WHEN EXISTS
               (SELECT 1 FROM speakers WHERE call_id = ?1 AND pass = 'archive')
               THEN 'archive' ELSE 'live' END)
         ORDER BY rowid",
    )?;
    let rows = stmt.query_map([call_id.as_str()], |r| {
        let channel: AudioChannel = word(&r.get::<_, String>(3)?).unwrap_or(AudioChannel::Sys);
        let label: String = r.get(1)?;
        let named_by: Option<String> = r.get(4)?;
        let speaker = SpeakerRef {
            speaker_id: SpeakerId::new(r.get::<_, String>(0)?),
            label: speaker_label(
                channel,
                &label,
                r.get(2)?,
                named_by.as_deref(),
                r.get::<_, Option<String>>(5)?,
            ),
        };
        let mut view = speaker_view(call_id, &speaker, channel);
        view.named_by = named_by.as_deref().and_then(word);
        Ok((label, view))
    })?;
    rows.collect()
}

fn marks_of(c: &Connection, call_id: &CallId) -> noter_db::rusqlite::Result<Vec<MarkView>> {
    let mut stmt =
        c.prepare("SELECT id, at_ms, note FROM marks WHERE call_id = ?1 ORDER BY at_ms, rowid")?;
    let rows = stmt.query_map([call_id.as_str()], |r| {
        Ok(MarkView {
            id: MarkId::new(r.get::<_, String>(0)?),
            call_id: call_id.clone(),
            at_ms: OffsetMs(r.get(1)?),
            note: r.get(2)?,
        })
    })?;
    rows.collect()
}

fn gaps_of(c: &Connection, call_id: &CallId) -> noter_db::rusqlite::Result<Vec<GapView>> {
    let mut stmt =
        c.prepare("SELECT t0_ms, t1_ms, reason FROM gaps WHERE call_id = ?1 ORDER BY t0_ms")?;
    let rows = stmt.query_map([call_id.as_str()], |r| {
        Ok(GapView {
            call_id: call_id.clone(),
            t0_ms: OffsetMs(r.get(0)?),
            t1_ms: OffsetMs(r.get(1)?),
            reason: word(&r.get::<_, String>(2)?).unwrap_or(GapReason::Interrupted),
        })
    })?;
    rows.collect()
}

impl Live {
    /// The speaker of an engine label; a new one is queued as a `speakers` row of pass `live`
    /// ahead of the segments that name it. The microphone's own voice is You, any other voice on
    /// it a guest on the user's side, and each new system label the next unnamed speaker.
    fn speaker(&mut self, call_id: &CallId, channel: AudioChannel, label: &str) -> SpeakerRef {
        let key = (channel, label.to_owned());
        if let Some(known) = self.speakers.get(&key) {
            return SpeakerRef {
                speaker_id: known.id.clone(),
                label: known.label.clone(),
            };
        }
        let n = (channel == AudioChannel::Sys).then(|| {
            self.speakers
                .keys()
                .filter(|(c, _)| *c == AudioChannel::Sys)
                .count() as u16
                + 1
        });
        let speaker = SpeakerRef {
            speaker_id: SpeakerId::new(format!("spk_{}", ulid::Ulid::generate())),
            label: speaker_label(channel, label, n.map(i64::from), None, None),
        };
        // @cpt-begin:cpt-noter-algo-core-live-transcript-speakers:p1:inst-you
        let named_by = matches!(speaker.label, SpeakerLabel::You).then_some("you");
        // @cpt-end:cpt-noter-algo-core-live-transcript-speakers:p1:inst-you
        // @cpt-begin:cpt-noter-algo-core-live-transcript-speakers:p1:inst-new-speaker
        self.rows.push(Insert {
            table: "speakers",
            values: vec![
                ("id", json!(speaker.speaker_id)),
                ("call_id", json!(call_id)),
                ("label", json!(label)),
                ("n", json!(n)),
                ("channel", json!(channel)),
                ("pass", json!("live")),
                ("named_by", json!(named_by)),
            ],
        });
        // @cpt-end:cpt-noter-algo-core-live-transcript-speakers:p1:inst-new-speaker
        self.speakers
            .insert(key, speaker_view(call_id, &speaker, channel));
        // @cpt-begin:cpt-noter-algo-core-live-transcript-speakers:p1:inst-return-speaker
        speaker
        // @cpt-end:cpt-noter-algo-core-live-transcript-speakers:p1:inst-return-speaker
    }
}

fn speaker_view(call_id: &CallId, speaker: &SpeakerRef, channel: AudioChannel) -> SpeakerView {
    SpeakerView {
        id: speaker.speaker_id.clone(),
        call_id: call_id.clone(),
        label: speaker.label.clone(),
        channel,
        segment_count: 0,
        talk_ms: None,
        sample: None,
        suggestion: None,
        named_by: matches!(speaker.label, SpeakerLabel::You).then_some(NamedBy::You),
    }
}

/// How a stored speaker is labelled on screen (names come with M2).
fn speaker_label(
    channel: AudioChannel,
    label: &str,
    n: Option<i64>,
    named_by: Option<&str>,
    person_id: Option<String>,
) -> SpeakerLabel {
    if let Some(id) = person_id {
        return SpeakerLabel::Person {
            person: chip(id, label),
        };
    }
    match channel {
        AudioChannel::Mic if label == "you" || named_by == Some("you") => SpeakerLabel::You,
        AudioChannel::Mic => SpeakerLabel::GuestYourSide,
        AudioChannel::Sys => SpeakerLabel::Unnamed {
            n: n.unwrap_or(0) as u16,
        },
    }
}

fn segment_view(seg: &EngineSegment, id: SegmentId, speaker: SpeakerRef) -> SegmentView {
    SegmentView {
        id,
        call_id: seg.call_id.clone(),
        channel: seg.channel,
        speaker,
        crosstalk_with: vec![],
        t0_ms: seg.t0_ms,
        t1_ms: seg.t1_ms,
        text: seg.text.clone(),
        lang: seg.lang.clone(),
        lang_p: seg.lang_p,
        confidence: confidence(seg.avg_logprob),
        state: match seg.state {
            EngineSegmentState::Hypothesis => SegmentState::Hypothesis,
            EngineSegmentState::Confirmed => SegmentState::Confirmed,
        },
        pass: TranscriptPass::Live,
        // shortcut: engine corrections carry no range yet, so none show before the term fixes of
        // M2; add them with `transcript_fix_term`.
        corrections: vec![],
    }
}

fn segment_row(seg: &EngineSegment, view: &SegmentView) -> Insert {
    Insert {
        table: "segments",
        values: vec![
            ("id", json!(view.id)),
            ("call_id", json!(view.call_id)),
            ("speaker_id", json!(view.speaker.speaker_id)),
            ("channel", json!(view.channel)),
            ("t0_ms", json!(view.t0_ms)),
            ("t1_ms", json!(view.t1_ms)),
            ("text", json!(view.text)),
            ("text_norm", json!(shadow(&view.text))),
            ("lang", json!(lang_word(&view.lang))),
            ("lang_p", json!(seg.lang_p)),
            ("avg_logprob", json!(seg.avg_logprob)),
            ("no_speech_p", json!(seg.no_speech_p)),
            ("pass", json!("live")),
            ("words_path", json!(seg.words_path)),
        ],
    }
}

/// The shadow text for the keyword index: lower-cased, ё folded to е, ß to ss.
// shortcut: no NFKC and no stemming (PRD › Retrieval function); retrieval adds both when it
// rebuilds the shadow column from `text`.
fn shadow(text: &str) -> String {
    text.to_lowercase().replace('ё', "е").replace('ß', "ss")
}

/// 0..1 from the average log-probability.
fn confidence(avg_logprob: f32) -> f32 {
    avg_logprob.exp().clamp(0.0, 1.0)
}

fn lang_word(lang: &Lang) -> String {
    match lang {
        Lang::En => "en".into(),
        Lang::Ru => "ru".into(),
        Lang::De => "de".into(),
        Lang::Other { code } => code.clone(),
    }
}

fn lang(word: &str) -> Lang {
    match word {
        "en" => Lang::En,
        "ru" => Lang::Ru,
        "de" => Lang::De,
        code => Lang::Other { code: code.into() },
    }
}

/// An enum column in the protocol's snake_case words.
fn word<T: serde::de::DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(Value::String(s.into())).ok()
}

/// A named speaker's chip. shortcut: no `people` table before library-people (M2), so the chip is
/// made from the stored name, as the library does; that feature reads the person's own record.
fn chip(person_id: String, name: &str) -> PersonChip {
    let words: Vec<&str> = name.split_whitespace().collect();
    PersonChip {
        id: PersonId::new(person_id),
        short_name: match words.as_slice() {
            [first, .., last] => format!("{first} {}.", last.chars().next().unwrap_or_default()),
            _ => name.to_string(),
        },
        initials: words
            .iter()
            .filter_map(|w| w.chars().next())
            .take(2)
            .collect::<String>()
            .to_uppercase(),
        display_name: name.to_string(),
        is_you: false,
    }
}
