//! FEATURE cpt-noter-feature-core-live-transcript (persistence and streams): hypotheses never
//! stored, confirmed segments batched, committed, then published; snapshot then stream; levels;
//! spans; `transcript.jsonl`; the commit-then-publish crash. Time is tokio's, paused (TL-4).

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use noter_core::{testing, Clock, Core, CoreDeps, EventEmitter};
use noter_db::{Insert, Mutation};
use noter_engine_client::scripted::ScriptedEngine;
use noter_engine_client::EngineLauncher;
use noter_protocol::engine::{EngineEvent, EngineSegment, EngineSegmentState};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

/// A clock the test moves (the levels hub coalesces on it).
#[derive(Default)]
struct Moving(AtomicI64);

impl Clock for Moving {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

struct Run {
    core: Arc<Core>,
    engine: ScriptedEngine,
    clock: Arc<Moving>,
}

fn open(dir: &Path) -> Run {
    let engine = ScriptedEngine::new();
    let clock = Arc::new(Moving::default());
    let launcher: Arc<dyn EngineLauncher> = Arc::new(engine.clone());
    let deps = CoreDeps::new(clock.clone(), Arc::new(NoEvents)).with_engine(launcher);
    let core = Arc::new(Core::open(dir, deps).expect("core opens"));
    core.start_first_run();
    Run {
        core,
        engine,
        clock,
    }
}

fn call_window() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::CallScreen,
        },
    }
}

fn collecting<T: Send + 'static>() -> (Sink<T>, Arc<Mutex<Vec<T>>>) {
    let got = Arc::new(Mutex::new(Vec::new()));
    let g = got.clone();
    (
        Sink::new(move |m| {
            g.lock().unwrap().push(m);
            true
        }),
        got,
    )
}

fn call_id() -> CallId {
    CallId::new("call_live")
}

/// A call row, as the capture session writes it.
fn new_call(core: &Core, status: &str) {
    core.store()
        .write(
            Mutation {
                entity_type: "call",
                table: "calls",
                id: "call_live".into(),
                base_rev: None,
                bump_rev: true,
                values: vec![
                    ("started_at", json!(1_792_137_600_000_i64)),
                    ("title", json!("Planning")),
                    ("call_type", json!("planning")),
                    ("status", json!(status)),
                    ("mode_used", json!("cloud_redacted")),
                ],
            },
            noter_db::ChangeMeta {
                actor: Actor::You,
                summary: "call".into(),
                reason: "test".into(),
                evidence_ids: vec![],
                batch_id: None,
                undoable: true,
                surface: None,
            },
        )
        .unwrap();
}

fn segment(
    state: EngineSegmentState,
    channel: AudioChannel,
    label: &str,
    t0: u32,
    text: &str,
) -> EngineEvent {
    EngineEvent::Segment {
        segment: EngineSegment {
            id: format!("eng_{t0}"),
            call_id: call_id(),
            channel,
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t0 + 1000),
            state,
            lang: Lang::En,
            lang_p: 0.9,
            speaker_label: label.into(),
            text: text.into(),
            words_path: None,
            avg_logprob: -0.1,
            no_speech_p: 0.01,
            corrections: vec![],
            crosstalk_labels: vec![],
        },
    }
}

fn confirmed(channel: AudioChannel, label: &str, t0: u32, text: &str) -> EngineEvent {
    segment(EngineSegmentState::Confirmed, channel, label, t0, text)
}

fn hypothesis(channel: AudioChannel, label: &str, t0: u32, text: &str) -> EngineEvent {
    segment(EngineSegmentState::Hypothesis, channel, label, t0, text)
}

async fn engine_up(r: &Run) {
    testing::engine_ready(&r.core).await;
}

/// Lets the core's listener and timers run for `ms` of (paused) time.
async fn settle(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

fn events(got: &Mutex<Vec<TranscriptMsg>>) -> Vec<TranscriptEvent> {
    got.lock()
        .unwrap()
        .iter()
        .map(|m| m.event.clone())
        .collect()
}

async fn subscribe(r: &Run) -> (TranscriptSnapshot, Arc<Mutex<Vec<TranscriptMsg>>>) {
    let (sink, got) = collecting();
    let snapshot = r
        .core
        .transcript_subscribe(
            &call_window(),
            TranscriptSubscribeArgs { call_id: call_id() },
            sink,
        )
        .await
        .unwrap();
    (snapshot, got)
}

fn stored(core: &Core, sql: &str) -> Vec<String> {
    core.store()
        .read(|c| {
            let mut stmt = c.prepare(sql)?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect()
        })
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn a_hypothesis_is_streamed_and_never_stored() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    let (snapshot, got) = subscribe(&r).await;
    assert!(snapshot.live && snapshot.segments.is_empty() && snapshot.subscription_id.is_some());
    engine_up(&r).await;
    r.engine
        .inject(hypothesis(AudioChannel::Sys, "spk_0", 0, "hel"));
    r.engine
        .inject(hypothesis(AudioChannel::Sys, "spk_0", 0, "hello"));
    settle(500).await;
    let heard = events(&got);
    assert_eq!(heard.len(), 2);
    assert!(
        matches!(&heard[1], TranscriptEvent::Hypothesis { segment } if segment.text == "hello" && segment.state == SegmentState::Hypothesis)
    );
    assert!(stored(&r.core, "SELECT id FROM segments").is_empty());
    // A window that arrives now sees the one current hypothesis and its speaker.
    let (late, _) = subscribe(&r).await;
    assert_eq!(late.hypotheses.len(), 1);
    assert_eq!(late.hypotheses[0].text, "hello");
    assert_eq!(late.speakers.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn confirmed_segments_commit_in_one_batch_and_publish_after_it() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    let (_, got) = subscribe(&r).await;
    engine_up(&r).await;
    r.engine
        .inject(hypothesis(AudioChannel::Mic, "you", 0, "Привет"));
    r.engine
        .inject(confirmed(AudioChannel::Mic, "you", 0, "Ёлка Straße"));
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_4", 1000, "second"));
    settle(100).await;
    // Inside the 250 ms window nothing is stored and no `confirmed` went out.
    assert!(stored(&r.core, "SELECT id FROM segments").is_empty());
    assert!(!events(&got)
        .iter()
        .any(|e| matches!(e, TranscriptEvent::Confirmed { .. })));
    settle(300).await;
    assert_eq!(
        stored(&r.core, "SELECT text_norm FROM segments ORDER BY t0_ms"),
        vec!["елка strasse", "second"]
    );
    let texts: Vec<_> = events(&got)
        .iter()
        .filter_map(|e| match e {
            TranscriptEvent::Confirmed { segment } => Some(segment.text.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(texts, vec!["Ёлка Straße", "second"]);
    // The confirmation removed the channel's hypothesis.
    let (late, _) = subscribe(&r).await;
    assert!(late.hypotheses.is_empty());
    assert_eq!(late.segments.len(), 2);
    assert!(late.segments[0].id.as_str().starts_with("seg_"));
}

#[tokio::test(start_paused = true)]
async fn live_speakers_become_rows_once_per_label() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    engine_up(&r).await;
    r.engine.inject(confirmed(AudioChannel::Mic, "you", 0, "a"));
    r.engine
        .inject(confirmed(AudioChannel::Mic, "mic_2", 1000, "b"));
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_7", 2000, "c"));
    r.engine.inject(EngineEvent::SpeakerTurn {
        call_id: call_id(),
        channel: AudioChannel::Sys,
        speaker_label: "spk_9".into(),
        at_ms: OffsetMs(2500),
    });
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_7", 3000, "d"));
    settle(400).await;
    assert_eq!(
        stored(
            &r.core,
            "SELECT label || ':' || pass || ':' || IFNULL(n, '-') FROM speakers ORDER BY rowid"
        ),
        vec!["you:live:-", "mic_2:live:-", "spk_7:live:1", "spk_9:live:2"]
    );
    let (snapshot, _) = subscribe(&r).await;
    let labels: Vec<_> = snapshot.speakers.iter().map(|s| s.label.clone()).collect();
    assert_eq!(
        labels,
        vec![
            SpeakerLabel::You,
            SpeakerLabel::GuestYourSide,
            SpeakerLabel::Unnamed { n: 1 },
            SpeakerLabel::Unnamed { n: 2 }
        ]
    );
    assert_eq!(snapshot.speakers[2].segment_count, 2);
    assert_eq!(snapshot.speakers[0].named_by, Some(NamedBy::You));
}

#[tokio::test(start_paused = true)]
async fn the_session_calls_reach_subscribers_and_the_snapshot_holds_the_rows() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    r.core
        .store()
        .insert_batch(vec![
            Insert {
                table: "marks",
                values: vec![
                    ("id", json!("mrk_1")),
                    ("call_id", json!("call_live")),
                    ("at_ms", json!(500)),
                    ("note", json!("hi")),
                ],
            },
            Insert {
                table: "gaps",
                values: vec![
                    ("call_id", json!("call_live")),
                    ("t0_ms", json!(100)),
                    ("t1_ms", json!(900)),
                    ("reason", json!("paused")),
                ],
            },
        ])
        .unwrap();
    let (snapshot, got) = subscribe(&r).await;
    assert_eq!(snapshot.marks[0].note.as_deref(), Some("hi"));
    assert_eq!(snapshot.gaps[0].reason, GapReason::Paused);
    let mark = MarkView {
        id: MarkId::new("mrk_2"),
        call_id: call_id(),
        at_ms: OffsetMs(700),
        note: None,
    };
    let gap = GapView {
        call_id: call_id(),
        t0_ms: OffsetMs(1000),
        t1_ms: OffsetMs(2000),
        reason: GapReason::EngineRestart,
    };
    testing::publish_mark(&r.core, mark.clone());
    testing::publish_gap(&r.core, gap.clone());
    assert_eq!(
        events(&got),
        vec![TranscriptEvent::Mark { mark }, TranscriptEvent::Gap { gap }]
    );
}

#[tokio::test(start_paused = true)]
async fn a_stopped_call_gives_the_whole_transcript_and_ends_the_stream_at_once() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "ready");
    let (snapshot, got) = subscribe(&r).await;
    assert!(!snapshot.live && snapshot.subscription_id.is_none());
    assert_eq!(
        events(&got),
        vec![TranscriptEvent::Ended {
            reason: StreamEndReason::CallStopped
        }]
    );
    let (sink, _) = collecting();
    let unknown = r
        .core
        .transcript_subscribe(
            &call_window(),
            TranscriptSubscribeArgs {
                call_id: CallId::new("call_none"),
            },
            sink,
        )
        .await
        .unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound);
}

#[tokio::test(start_paused = true)]
async fn stopping_commits_the_last_batch_writes_the_file_and_ends_streams() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    let (_, got) = subscribe(&r).await;
    engine_up(&r).await;
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_0", 0, "last words"));
    settle(10).await; // inside the batch window: only the stop can commit it
    r.engine.inject(EngineEvent::SessionStopped {
        call_id: call_id(),
        timeline_path: "t.json".into(),
        mic_path: None,
        sys_path: None,
    });
    settle(10).await;
    let heard = events(&got);
    assert!(
        matches!(&heard[0], TranscriptEvent::Confirmed { segment } if segment.text == "last words")
    );
    assert_eq!(
        heard[1],
        TranscriptEvent::Ended {
            reason: StreamEndReason::CallStopped
        }
    );
    let file = dir.path().join("audio/call_live/transcript.jsonl");
    let lines = std::fs::read_to_string(&file).unwrap();
    assert_eq!(lines.lines().count(), 1);
    assert!(lines.contains("last words"));
    assert_eq!(
        std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert!(!dir
        .path()
        .join("audio/call_live/transcript.jsonl.tmp")
        .exists());
    // A second stop (the session's own call) changes nothing.
    testing::end_call(&r.core, &call_id(), StreamEndReason::CallStopped);
    assert_eq!(events(&got).len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_discarded_call_drops_its_open_batch_and_writes_no_file() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    let (_, got) = subscribe(&r).await;
    engine_up(&r).await;
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_0", 0, "secret"));
    settle(10).await;
    testing::end_call(&r.core, &call_id(), StreamEndReason::Discarded);
    settle(400).await;
    assert_eq!(
        events(&got),
        vec![TranscriptEvent::Ended {
            reason: StreamEndReason::Discarded
        }]
    );
    assert!(stored(&r.core, "SELECT id FROM segments").is_empty());
    assert!(!dir.path().join("audio").exists());
}

#[tokio::test(start_paused = true)]
async fn a_crash_between_commit_and_publish_loses_and_doubles_nothing() {
    let dir = tempfile::tempdir().unwrap();
    {
        let r = open(dir.path());
        new_call(&r.core, "recording");
        let (_, got) = subscribe(&r).await;
        engine_up(&r).await;
        testing::fail_transcript_after_commit_once(&r.core);
        r.engine
            .inject(confirmed(AudioChannel::Sys, "spk_0", 0, "committed"));
        settle(400).await;
        // Committed, but the core died before it published.
        assert_eq!(
            stored(&r.core, "SELECT text FROM segments"),
            vec!["committed"]
        );
        assert!(events(&got).is_empty());
        // A window that subscribes in that moment must not see the line twice: the snapshot
        // leaves it out because the stream would have delivered it.
        let (snapshot, _) = subscribe(&r).await;
        assert!(snapshot.segments.is_empty());
        r.core.shutdown().await;
    }
    // After the restart the snapshot holds the segment once, and the speaker is not duplicated.
    let r = open(dir.path());
    let (snapshot, _) = subscribe(&r).await;
    assert_eq!(snapshot.segments.len(), 1);
    engine_up(&r).await;
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_0", 2000, "after"));
    settle(400).await;
    assert_eq!(stored(&r.core, "SELECT label FROM speakers"), vec!["spk_0"]);
    let (snapshot, _) = subscribe(&r).await;
    let texts: Vec<_> = snapshot.segments.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(texts, vec!["committed", "after"]);
}

#[tokio::test(start_paused = true)]
async fn levels_are_coalesced_to_one_per_100_ms() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    let (sink, got) = collecting::<LevelsMsg>();
    r.core
        .levels_subscribe(&call_window(), SubscribeLevelsArgs { call_id: None }, sink)
        .await
        .unwrap();
    engine_up(&r).await;
    let levels = |mic_db| EngineEvent::Levels {
        call_id: None,
        mic_db,
        sys_db: -50.0,
    };
    r.clock.0.store(1_000, Ordering::SeqCst);
    r.engine.inject(levels(-20.0));
    settle(1).await;
    r.clock.0.store(1_040, Ordering::SeqCst);
    r.engine.inject(levels(-21.0)); // 40 ms later: dropped
    settle(1).await;
    r.clock.0.store(1_120, Ordering::SeqCst);
    r.engine.inject(levels(-22.0));
    settle(1).await;
    let heard: Vec<(f32, u64)> = got
        .lock()
        .unwrap()
        .iter()
        .map(|m| (m.mic_db, m.seq.0))
        .collect();
    assert_eq!(heard, vec![(-20.0, 1), (-22.0, 2)]);
}

#[tokio::test(start_paused = true)]
async fn a_span_returns_the_overlapping_lines_with_their_call() {
    let dir = tempfile::tempdir().unwrap();
    let r = open(dir.path());
    new_call(&r.core, "recording");
    engine_up(&r).await;
    r.engine
        .inject(confirmed(AudioChannel::Mic, "you", 0, "zero"));
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_0", 1000, "one"));
    r.engine
        .inject(confirmed(AudioChannel::Sys, "spk_0", 5000, "five"));
    settle(400).await;
    let span = |channel, t0, t1| SpanArgs {
        span: TimeSpan {
            call_id: call_id(),
            channel,
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t1),
        },
    };
    let both = r
        .core
        .transcript_span(&call_window(), span(None, 500, 1500))
        .await
        .unwrap();
    let texts: Vec<_> = both.segments.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(texts, vec!["zero", "one"]);
    assert_eq!(both.call.title, "Planning");
    assert!(both.audio_available && !both.upgraded_by_archive);
    let sys = r
        .core
        .transcript_span(&call_window(), span(Some(AudioChannel::Sys), 0, 10_000))
        .await
        .unwrap();
    assert_eq!(sys.segments.len(), 2);
    let none = SpanArgs {
        span: TimeSpan {
            call_id: CallId::new("call_none"),
            channel: None,
            t0_ms: OffsetMs(0),
            t1_ms: OffsetMs(1),
        },
    };
    assert_eq!(
        r.core
            .transcript_span(&call_window(), none)
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    );
}
