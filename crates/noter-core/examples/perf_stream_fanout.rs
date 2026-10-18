//! Perf scenario `core_stream_fanout` (harness/perf.toml).
//!
//! One live call's transcript fanned out by the stream hub to three windows (the main
//! window's call page, the call window and a second call page): each window subscribes
//! through the core, every message is serialized for each Channel as the IPC host does, and
//! each window acknowledges once a second (every 10 messages at 10 msg/s) through
//! `stream_ack`. Measured by the perf gate in instruction counts (cachegrind) on Linux and in
//! wall time on the Mac runner, so it runs on one thread with a fixed clock and fixed sizes.
//!
//! Persistence is not in it yet: segments are written by the live transcript service
//! (core-live-transcript, M1), which does not exist yet.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use noter_core::{Clock, Core, CoreDeps, EventEmitter, StreamMsg};
use noter_protocol::fixtures::world;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde::Serialize;
use serde_json::Value;

/// Five minutes of transcript at 10 msg/s.
const MESSAGES: u64 = 3_000;
const ACK_EVERY: u64 = 10;
const CALL: &str = "call_perf";
const WINDOWS: [WindowLabel; 3] = [
    WindowLabel::Main,
    WindowLabel::CallScreen,
    WindowLabel::Main,
];

/// A transcript Channel message, shaped like the contract's: a confirmed segment, or the end.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Line {
    Confirmed { seq: Seq, segment: Box<SegmentView> },
    Ended { seq: Seq, reason: StreamEndReason },
}

impl StreamMsg for Line {
    fn set_seq(&mut self, at: Seq) {
        match self {
            Line::Confirmed { seq, .. } | Line::Ended { seq, .. } => *seq = at,
        }
    }
    fn ended(reason: StreamEndReason) -> Option<Self> {
        Some(Line::Ended {
            seq: Seq(0),
            reason,
        })
    }
}

/// A window's end of its Channel.
#[derive(Default)]
struct Window {
    last_seq: AtomicU64,
    messages: AtomicUsize,
    bytes: AtomicUsize,
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _event: &'static str, _payload: Value) {}
}

/// What the windows received: confirmed segments, and the serialized bytes as a checksum.
struct Delivered {
    messages: usize,
    bytes: usize,
}

fn fanout(messages: u64) -> Delivered {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    let dir = tempfile::tempdir().expect("temp data folder");
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents));
    let core = Core::open(dir.path(), deps).expect("core opens");
    let segments: Vec<SegmentView> = world()
        .transcripts
        .into_iter()
        .flat_map(|t| t.segments)
        .collect();
    assert!(!segments.is_empty(), "the fixture world has segments");

    let hub = core.stream_hub::<Line>(None);
    let windows: Vec<(CommandCtx, Arc<Window>, SubscriptionId)> = WINDOWS
        .iter()
        .map(|&label| {
            let ctx = CommandCtx {
                caller: Caller::Window { label },
            };
            let window = Arc::new(Window::default());
            let w = window.clone();
            let sink = Sink::new(move |m: Line| {
                let bytes = serde_json::to_vec(&m).expect("message serializes").len();
                w.bytes.fetch_add(bytes, Ordering::Relaxed);
                if let Line::Confirmed { seq, .. } = m {
                    w.last_seq.store(seq.0, Ordering::Relaxed);
                    w.messages.fetch_add(1, Ordering::Relaxed);
                }
                true
            });
            let sub = core
                .subscribe(&hub, CALL, &ctx, sink, || Ok(()))
                .expect("subscribes");
            (ctx, window, sub.subscription_id)
        })
        .collect();

    for n in 0..messages {
        let segment = Box::new(segments[(n as usize) % segments.len()].clone());
        hub.publish(
            CALL,
            Line::Confirmed {
                seq: Seq(0),
                segment,
            },
        );
        if (n + 1) % ACK_EVERY == 0 {
            for (ctx, window, id) in &windows {
                let args = StreamAckArgs {
                    subscription_id: id.clone(),
                    seq: Seq(window.last_seq.load(Ordering::Relaxed)),
                };
                runtime
                    .block_on(core.stream_ack(ctx, args))
                    .expect("stream_ack");
            }
        }
    }
    runtime.block_on(core.shutdown());

    let delivered = Delivered {
        messages: windows
            .iter()
            .map(|(_, w, _)| w.messages.load(Ordering::Relaxed))
            .sum(),
        bytes: windows
            .iter()
            .map(|(_, w, _)| w.bytes.load(Ordering::Relaxed))
            .sum(),
    };
    std::hint::black_box(&delivered.bytes);
    delivered
}

fn main() {
    let d = fanout(MESSAGES);
    println!("{} {}", d.messages, d.bytes);
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_window_gets_every_message_once() {
        let d = super::fanout(25);
        assert_eq!(d.messages, 3 * 25);
        assert!(d.bytes > 0);
    }
}
