//! Perf scenario `core_stream_fanout` (`.plans/perf-m1.md`; registry entry `stream-hub-fanout`).
//!
//! One call's transcript stream fanned out to three windows: 3 000 confirmed segments (five
//! minutes at 10 msg/s) through one `StreamHub`, every Channel message serialized to JSON in its
//! sink as the IPC host does, every window acknowledging through `stream_ack` every 10 messages,
//! then `shutdown` ends the streams. Deterministic for the instruction-count gate: one thread,
//! fixed clock, no coalescing, fixed sizes. Prints `delivered_messages bytes`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use noter_core::{Clock, Core, CoreDeps, EventEmitter};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

const MESSAGES: usize = 3_000;
const ACK_EVERY: usize = 10;

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

fn segment(n: usize) -> SegmentView {
    SegmentView {
        id: SegmentId::new(format!("seg_{n:04}")),
        call_id: CallId::new("call_live"),
        channel: AudioChannel::Sys,
        speaker: SpeakerRef {
            speaker_id: SpeakerId::new("spk_1"),
            label: SpeakerLabel::Unnamed { n: 1 },
        },
        crosstalk_with: vec![],
        t0_ms: OffsetMs(n as u32 * 100),
        t1_ms: OffsetMs(n as u32 * 100 + 90),
        text: "We agreed to ship the harness controls before the transcript lands.".into(),
        lang: Lang::En,
        lang_p: 0.93,
        confidence: 0.9,
        state: SegmentState::Confirmed,
        pass: TranscriptPass::Live,
        corrections: vec![],
    }
}

/// Fans `messages` segments out to three windows; returns (messages delivered, bytes written).
fn fan_out(messages: usize) -> (usize, usize) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    let dir = tempfile::tempdir().expect("temp data folder");
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(NoEvents));
    let core = Core::open(dir.path(), deps).expect("core opens");
    let hub = core.stream_hub::<TranscriptMsg>(None);
    let delivered = Arc::new(AtomicUsize::new(0));
    let bytes = Arc::new(AtomicUsize::new(0));
    let windows = [
        WindowLabel::Main,
        WindowLabel::CallScreen,
        WindowLabel::Main,
    ];
    let subscriptions: Vec<SubscriptionId> = windows
        .iter()
        .map(|label| {
            let (delivered, bytes) = (delivered.clone(), bytes.clone());
            let sink = Sink::new(move |msg: TranscriptMsg| {
                // The host serializes every message, the ending one included.
                bytes.fetch_add(
                    serde_json::to_string(&msg)
                        .expect("message serializes")
                        .len(),
                    Ordering::Relaxed,
                );
                if !matches!(msg.event, TranscriptEvent::Ended { .. }) {
                    delivered.fetch_add(1, Ordering::Relaxed);
                }
                true
            });
            let ctx = CommandCtx {
                caller: Caller::Window { label: *label },
            };
            core.subscribe(&hub, "call_live", &ctx, sink, || Ok(()))
                .expect("subscribes")
                .subscription_id
        })
        .collect();
    let ctx = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    for n in 1..=messages {
        let seq = hub.publish(
            "call_live",
            TranscriptMsg {
                seq: Seq(0),
                event: TranscriptEvent::Confirmed {
                    segment: segment(n),
                },
            },
        );
        if n % ACK_EVERY == 0 {
            for id in &subscriptions {
                runtime
                    .block_on(core.stream_ack(
                        &ctx,
                        StreamAckArgs {
                            subscription_id: id.clone(),
                            seq,
                        },
                    ))
                    .expect("ack");
            }
        }
    }
    runtime.block_on(core.shutdown());
    (
        delivered.load(Ordering::Relaxed),
        bytes.load(Ordering::Relaxed),
    )
}

// @cpt-dod:cpt-noter-dod-core-live-transcript-stream:p1
fn main() {
    let (delivered, bytes) = fan_out(MESSAGES);
    println!("{delivered} {bytes}");
}

#[cfg(test)]
mod tests {
    #[test]
    fn every_window_gets_every_message_once() {
        assert_eq!(super::fan_out(25).0, 75);
    }
}
