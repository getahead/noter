//! `CoreApi` as the real core, the IPC host and `noter-core-harness` consume it
//! (`cpt-noter-dod-core-contract-coreapi`): one method per command with the command's
//! argument, result and Channel types, reached by name through `dispatch_json`.

use std::future::Future;
use std::pin::pin;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use noter_protocol::ipc::{
    command, dispatch_json, Caller, CommandCtx, CoreApi, NativeSurface, Sink, COMMANDS,
};
use noter_protocol::model::*;
use noter_protocol::{Ack, AudioChannel, CoreError, ErrorCode, Seq, SubscriptionId};
use serde_json::{json, Value};

/// Runs a future to completion on this thread (the crate has no async runtime).
fn block_on<F: Future>(fut: F) -> F::Output {
    struct Unpark(std::thread::Thread);
    impl Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut fut = pin!(fut);
    loop {
        if let Poll::Ready(v) = fut.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::park();
    }
}

fn window(label: WindowLabel) -> CommandCtx {
    CommandCtx {
        caller: Caller::Window { label },
    }
}

/// A core that answers nothing: every method keeps its `not_implemented` default.
struct Early;
impl CoreApi for Early {}

/// A core that answers two commands, one of them over a Channel.
#[derive(Default)]
struct Answering {
    acked: Mutex<Vec<(String, u64, Caller)>>,
    delivered: Mutex<Vec<bool>>,
}

impl CoreApi for Answering {
    async fn stream_ack(&self, ctx: &CommandCtx, args: StreamAckArgs) -> Result<Ack, CoreError> {
        self.acked.lock().unwrap().push((
            args.subscription_id.as_str().to_string(),
            args.seq.0,
            ctx.caller,
        ));
        Ok(Ack {})
    }

    async fn self_test_run(
        &self,
        _ctx: &CommandCtx,
        args: SelfTestArgs,
        channel: Sink<SelfTestMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        let event = if args.play_clip {
            SelfTestEvent::Passed
        } else {
            SelfTestEvent::StreamArrived {
                channel: AudioChannel::Mic,
            }
        };
        let delivered = channel.send(SelfTestMsg { seq: Seq(1), event });
        self.delivered.lock().unwrap().push(delivered);
        Ok(SubscriptionHandle {
            subscription_id: SubscriptionId::new("sub_selftest"),
        })
    }
}

fn first_window(name: &str) -> WindowLabel {
    command(name).unwrap().windows[0]
}

fn collecting() -> (Sink<Value>, Arc<Mutex<Vec<Value>>>) {
    let got = Arc::new(Mutex::new(Vec::new()));
    let g = got.clone();
    let sink = Sink::new(move |m: Value| {
        g.lock().unwrap().push(m);
        true
    });
    (sink, got)
}

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-coreapi
#[test]
fn every_command_reaches_its_own_core_api_method() {
    // `{}` parses for commands without required fields: the default method answers
    // `not_implemented` naming the command. Otherwise the arguments are refused with
    // `invalid_input` naming the command and its argument type, which proves the route
    // parses into that command's type.
    for c in COMMANDS {
        let channel = c.channel.map(|_| collecting().0);
        let err = block_on(dispatch_json(
            &Early,
            &window(c.windows[0]),
            c.name,
            json!({}),
            channel,
        ))
        .expect_err(c.name);
        match err.code {
            ErrorCode::NotImplemented => assert_eq!(err.message, c.name),
            ErrorCode::InvalidInput => assert!(
                err.message.starts_with(&format!("{}: ", c.name))
                    && err.message.contains(&c.args.replace(' ', "")),
                "{}: {}",
                c.name,
                err.message
            ),
            // @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-return-tests
            other => panic!("{}: unexpected {other:?}", c.name),
            // @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-return-tests
        }
    }
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-coreapi

#[test]
fn an_unknown_command_is_invalid_input() {
    let err = block_on(dispatch_json(
        &Early,
        &window(WindowLabel::Main),
        "no_such_command",
        json!({}),
        None,
    ))
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[test]
fn a_window_outside_the_scope_is_refused_before_the_arguments_are_read() {
    let err = block_on(dispatch_json(
        &Answering::default(),
        &window(WindowLabel::CallScreen),
        "settings_update",
        json!("not even an object"),
        None,
    ))
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
    assert!(!err.retryable);
}

#[test]
fn check_caller_applies_the_window_scope_and_lets_native_surfaces_through() {
    let c = command("calls_delete").unwrap();
    assert!(c
        .check_caller(&Caller::Window {
            label: WindowLabel::Main
        })
        .is_ok());
    assert_eq!(
        c.check_caller(&Caller::Window {
            label: WindowLabel::CallScreen
        })
        .unwrap_err()
        .code,
        ErrorCode::WindowNotAllowed
    );
    assert!(c
        .check_caller(&Caller::Native {
            surface: NativeSurface::Menu
        })
        .is_ok());
}

#[test]
fn arguments_and_results_cross_as_json_with_the_caller() {
    let core = Answering::default();
    let out = block_on(dispatch_json(
        &core,
        &window(WindowLabel::Settings),
        "stream_ack",
        json!({"subscription_id": "sub_1", "seq": 7}),
        None,
    ))
    .unwrap();
    assert_eq!(out, json!({}));
    let native = CommandCtx {
        caller: Caller::Native {
            surface: NativeSurface::Hotkey,
        },
    };
    block_on(dispatch_json(
        &core,
        &native,
        "stream_ack",
        json!({"subscription_id": "sub_2", "seq": 8}),
        None,
    ))
    .unwrap();
    let acked = core.acked.lock().unwrap();
    assert_eq!(
        acked[0],
        (
            "sub_1".into(),
            7,
            Caller::Window {
                label: WindowLabel::Settings
            }
        )
    );
    assert_eq!(
        acked[1].2,
        Caller::Native {
            surface: NativeSurface::Hotkey
        }
    );
}

#[test]
fn unparsable_arguments_are_invalid_input_without_echoing_the_input() {
    let err = block_on(dispatch_json(
        &Answering::default(),
        &window(WindowLabel::Main),
        "stream_ack",
        json!({"subscription_id": "secret transcript words", "seq": "x"}),
        None,
    ))
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
    assert!(!err.message.contains("secret"), "{}", err.message);
}

#[test]
fn a_subscribing_command_streams_its_channel_messages_as_json() {
    let (sink, got) = collecting();
    let out = block_on(dispatch_json(
        &Answering::default(),
        &window(first_window("self_test_run")),
        "self_test_run",
        json!({"play_clip": false}),
        Some(sink),
    ))
    .unwrap();
    assert_eq!(out, json!({"subscription_id": "sub_selftest"}));
    assert_eq!(
        *got.lock().unwrap(),
        vec![json!({"seq": 1, "event": {"type": "stream_arrived", "channel": "mic"}})]
    );
}

#[test]
fn a_subscribing_command_without_a_channel_is_invalid_input() {
    let err = block_on(dispatch_json(
        &Answering::default(),
        &window(first_window("self_test_run")),
        "self_test_run",
        json!({"play_clip": true}),
        None,
    ))
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidInput);
}

#[test]
fn a_closed_channel_reports_false_to_the_core() {
    let core = Answering::default();
    let closed = Sink::new(|_: Value| false);
    block_on(dispatch_json(
        &core,
        &window(first_window("self_test_run")),
        "self_test_run",
        json!({"play_clip": true}),
        Some(closed),
    ))
    .unwrap();
    // `false` is the core's signal to drop the subscription (window closed).
    assert_eq!(*core.delivered.lock().unwrap(), vec![false]);
}
