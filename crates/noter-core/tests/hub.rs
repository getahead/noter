//! FEATURE cpt-noter-feature-core-ipc-host: the stream hub, proven with a test stream kind
//! (Teamlead decision D6). Ordering, ack and unsubscribe run end to end with self_test_run.

use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use noter_core::{Clock, Core, CoreDeps, EventEmitter, StreamHub, StreamMsg, LAG_LIMIT};
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
enum TestMsg {
    Value { seq: Seq, n: u32 },
    Ended { seq: Seq, reason: StreamEndReason },
}

impl StreamMsg for TestMsg {
    fn set_seq(&mut self, at: Seq) {
        match self {
            TestMsg::Value { seq, .. } | TestMsg::Ended { seq, .. } => *seq = at,
        }
    }
    fn ended(reason: StreamEndReason) -> Option<Self> {
        Some(TestMsg::Ended {
            seq: Seq(0),
            reason,
        })
    }
}

fn value(n: u32) -> TestMsg {
    TestMsg::Value { seq: Seq(0), n }
}

/// A window's end of a Channel: what arrived, and whether it is still open.
#[derive(Clone, Default)]
struct Window(Arc<Mutex<Vec<TestMsg>>>, Arc<Mutex<bool>>);

impl Window {
    fn sink(&self) -> Sink<TestMsg> {
        let (got, closed) = (self.0.clone(), self.1.clone());
        Sink::new(move |m| {
            if *closed.lock().unwrap() {
                return false;
            }
            got.lock().unwrap().push(m);
            true
        })
    }
    fn got(&self) -> Vec<TestMsg> {
        self.0.lock().unwrap().clone()
    }
    fn seqs(&self) -> Vec<u64> {
        self.got()
            .iter()
            .filter_map(|m| {
                if let TestMsg::Value { seq, .. } = m {
                    Some(seq.0)
                } else {
                    None
                }
            })
            .collect()
    }
    fn ended(&self) -> Option<StreamEndReason> {
        self.got().iter().find_map(|m| {
            if let TestMsg::Ended { reason, .. } = m {
                Some(*reason)
            } else {
                None
            }
        })
    }
}

#[derive(Default)]
struct TestClock(AtomicI64);

impl Clock for TestClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(self.0.load(Ordering::SeqCst))
    }
}

fn hub(coalesce_ms: Option<i64>) -> (StreamHub<TestMsg>, Arc<TestClock>) {
    let clock = Arc::new(TestClock::default());
    (StreamHub::new(clock.clone(), coalesce_ms), clock)
}

const MAIN: Option<WindowLabel> = Some(WindowLabel::Main);
const CALL: Option<WindowLabel> = Some(WindowLabel::CallScreen);

#[test]
fn a_channel_starts_after_the_snapshot_with_consecutive_seqs() {
    let (hub, _) = hub(None);
    hub.publish("call_1", value(1));
    hub.publish("call_1", value(2));
    let w = Window::default();
    let sub = hub
        .subscribe("call_1", CALL, w.sink(), || Ok("snapshot"))
        .unwrap();
    assert_eq!((sub.snapshot, sub.last_seq), ("snapshot", Seq(2)));
    assert!(sub.subscription_id.as_str().starts_with("sub_"));
    for n in 3..=5 {
        assert_eq!(hub.publish("call_1", value(n)), Seq(n.into()));
    }
    assert_eq!(
        w.seqs(),
        [3, 4, 5],
        "nothing at or before last_seq, nothing skipped"
    );
    // Another stream has its own sequence.
    assert_eq!(hub.publish("call_2", value(1)), Seq(1));
    assert_eq!(w.seqs(), [3, 4, 5]);
}

#[test]
fn a_failed_snapshot_registers_nothing() {
    let (hub, _) = hub(None);
    let w = Window::default();
    let err = hub
        .subscribe("call_1", MAIN, w.sink(), || -> Result<(), CoreError> {
            Err(CoreError::new(ErrorCode::NotFound, "call_1"))
        })
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
    hub.publish("call_1", value(1));
    assert!(w.got().is_empty());
}

#[test]
fn a_subscriber_that_stops_acknowledging_ends_lagged_at_the_limit() {
    let (hub, _) = hub(None);
    let (slow, quick) = (Window::default(), Window::default());
    hub.subscribe("call_1", CALL, slow.sink(), || Ok(()))
        .unwrap();
    let id = hub
        .subscribe("call_1", MAIN, quick.sink(), || Ok(()))
        .unwrap()
        .subscription_id;
    for n in 1..LAG_LIMIT {
        let seq = hub.publish("call_1", value(n as u32));
        if n % 100 == 0 {
            assert!(hub.ack(&id, seq));
        }
    }
    assert_eq!(slow.ended(), None, "one short of the limit");
    hub.publish("call_1", value(0));
    assert_eq!(slow.ended(), Some(StreamEndReason::Lagged));
    assert_eq!(quick.ended(), None, "a window that acknowledges stays");
    let before = slow.got().len();
    hub.publish("call_1", value(0));
    assert_eq!(slow.got().len(), before, "dropped after the end");
    assert_eq!(quick.seqs().len(), LAG_LIMIT as usize + 1);
}

#[test]
fn an_ack_never_moves_back() {
    let (hub, _) = hub(None);
    let w = Window::default();
    let id = hub
        .subscribe("call_1", MAIN, w.sink(), || Ok(()))
        .unwrap()
        .subscription_id;
    for n in 0..500 {
        hub.publish("call_1", value(n));
    }
    assert!(hub.ack(&id, Seq(500)));
    assert!(hub.ack(&id, Seq(10)));
    for n in 0..LAG_LIMIT - 1 {
        hub.publish("call_1", value(n as u32));
    }
    assert_eq!(w.ended(), None, "counted from 500, not 10");
    hub.publish("call_1", value(0));
    assert_eq!(w.ended(), Some(StreamEndReason::Lagged));
    assert!(!hub.ack(&id, Seq(3000)), "an ended subscription is gone");
}

#[test]
fn unsubscribe_ends_one_subscription() {
    let (hub, _) = hub(None);
    let (a, b) = (Window::default(), Window::default());
    let id = hub
        .subscribe("call_1", MAIN, a.sink(), || Ok(()))
        .unwrap()
        .subscription_id;
    hub.subscribe("call_1", MAIN, b.sink(), || Ok(())).unwrap();
    assert!(hub.unsubscribe(&id));
    assert!(!hub.unsubscribe(&id));
    assert_eq!(a.ended(), Some(StreamEndReason::Unsubscribed));
    hub.publish("call_1", value(1));
    assert_eq!((a.seqs(), b.seqs()), (vec![], vec![1]));
}

#[test]
fn a_reloaded_webview_loses_its_subscriptions_only() {
    let (hub, _) = hub(None);
    let (call, main) = (Window::default(), Window::default());
    hub.subscribe("call_1", CALL, call.sink(), || Ok(()))
        .unwrap();
    hub.subscribe("call_1", MAIN, main.sink(), || Ok(()))
        .unwrap();
    hub.end_webview(WindowLabel::CallScreen);
    assert_eq!(call.ended(), Some(StreamEndReason::Unsubscribed));
    hub.publish("call_1", value(1));
    assert_eq!((call.seqs(), main.seqs()), (vec![], vec![1]));
}

#[test]
fn a_stream_ends_with_its_reason() {
    let (hub, _) = hub(None);
    let (one, two) = (Window::default(), Window::default());
    hub.subscribe("call_1", MAIN, one.sink(), || Ok(()))
        .unwrap();
    hub.subscribe("call_2", MAIN, two.sink(), || Ok(()))
        .unwrap();
    hub.end_stream("call_1", StreamEndReason::CallStopped);
    assert_eq!(
        (one.ended(), two.ended()),
        (Some(StreamEndReason::CallStopped), None)
    );
    hub.end_all(StreamEndReason::Shutdown);
    assert_eq!(two.ended(), Some(StreamEndReason::Shutdown));
}

#[test]
fn a_closed_channel_is_dropped() {
    let (hub, _) = hub(None);
    let w = Window::default();
    let id = hub
        .subscribe("call_1", MAIN, w.sink(), || Ok(()))
        .unwrap()
        .subscription_id;
    *w.1.lock().unwrap() = true;
    hub.publish("call_1", value(1));
    assert!(!hub.ack(&id, Seq(1)), "gone after the failed send");
}

#[test]
fn levels_are_coalesced_per_subscription() {
    let (hub, clock) = hub(Some(100));
    let w = Window::default();
    hub.subscribe("levels", MAIN, w.sink(), || Ok(())).unwrap();
    for _ in 0..3 {
        hub.publish("levels", value(0));
    }
    clock.0.store(99, Ordering::SeqCst);
    hub.publish("levels", value(0));
    clock.0.store(100, Ordering::SeqCst);
    hub.publish("levels", value(0));
    assert_eq!(w.seqs(), [1, 5]);
}

#[test]
fn the_replay_buffer_keeps_the_last_lag_limit_messages() {
    let (hub, _) = hub(None);
    for n in 0..LAG_LIMIT + 100 {
        hub.publish("call_1", value(n as u32));
    }
    let kept = hub.replay_after("call_1", Seq(0));
    assert_eq!(kept.len(), LAG_LIMIT as usize);
    assert_eq!(
        kept.first(),
        Some(&TestMsg::Value {
            seq: Seq(101),
            n: 100
        })
    );
    assert_eq!(hub.replay_after("call_1", Seq(LAG_LIMIT + 98)).len(), 2);
    assert!(hub.replay_after("nothing", Seq(0)).is_empty());
}

struct NoEvents;

impl EventEmitter for NoEvents {
    fn emit(&self, _: &'static str, _: Value) {}
}

fn core(dir: &Path) -> Core {
    let clock = Arc::new(TestClock::default());
    Core::open(dir, CoreDeps::new(clock, Arc::new(NoEvents))).unwrap()
}

fn from(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

#[tokio::test]
async fn the_core_routes_acks_unsubscribes_reloads_and_shutdown_to_its_hubs() {
    let dir = tempfile::tempdir().unwrap();
    let core = core(dir.path());
    let hub = core.stream_hub::<TestMsg>(None);
    let (a, b, c) = (Window::default(), Window::default(), Window::default());
    let id = hub
        .subscribe("call_1", MAIN, a.sink(), || Ok(()))
        .unwrap()
        .subscription_id;
    hub.subscribe("call_1", CALL, b.sink(), || Ok(())).unwrap();
    hub.subscribe("call_1", MAIN, c.sink(), || Ok(())).unwrap();
    hub.publish("call_1", value(1));

    let main = from(WindowLabel::Main);
    let ack = StreamAckArgs {
        subscription_id: id.clone(),
        seq: Seq(1),
    };
    assert_eq!(core.stream_ack(&main, ack.clone()).await.unwrap(), Ack {});
    let unsub = UnsubscribeArgs {
        subscription_id: id.clone(),
    };
    assert_eq!(
        core.stream_unsubscribe(&main, unsub.clone()).await.unwrap(),
        Ack {}
    );
    assert_eq!(a.ended(), Some(StreamEndReason::Unsubscribed));
    // Late or repeated calls for an ended subscription are harmless.
    assert_eq!(core.stream_ack(&main, ack).await.unwrap(), Ack {});
    assert_eq!(core.stream_unsubscribe(&main, unsub).await.unwrap(), Ack {});

    core.webview_reset(WindowLabel::CallScreen);
    assert_eq!(b.ended(), Some(StreamEndReason::Unsubscribed));
    core.shutdown().await;
    assert_eq!(c.ended(), Some(StreamEndReason::Shutdown));
}

#[tokio::test]
async fn a_subscribing_command_belongs_to_the_calling_window() {
    let dir = tempfile::tempdir().unwrap();
    let core = core(dir.path());
    let hub = core.stream_hub::<TestMsg>(None);
    let (window, native) = (Window::default(), Window::default());
    let store = core.store();
    let snapshot = || {
        store.read_snapshot(|c| {
            c.query_row("SELECT count(*) FROM changes", [], |r| r.get::<_, i64>(0))
        })
    };
    let from_call = core
        .subscribe(
            &hub,
            "call_1",
            &from(WindowLabel::CallScreen),
            window.sink(),
            snapshot,
        )
        .unwrap();
    assert_eq!((from_call.snapshot, from_call.last_seq), (0, Seq(0)));
    let menu = CommandCtx {
        caller: Caller::Native {
            surface: noter_protocol::ipc::NativeSurface::MenuBar,
        },
    };
    core.subscribe(&hub, "call_1", &menu, native.sink(), || Ok(()))
        .unwrap();
    core.webview_reset(WindowLabel::CallScreen);
    hub.publish("call_1", value(1));
    assert_eq!(window.ended(), Some(StreamEndReason::Unsubscribed));
    assert_eq!(
        native.seqs(),
        [1],
        "a native surface has no webview to reload"
    );
}
