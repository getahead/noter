//! The noter-core-harness wire format (docs/HARNESS.md), in process over `tokio::io::duplex`
//! against a stub core (`.plans/core-harness.md` §4, W1–W8). The stub answers a handful of
//! commands; every other one keeps the `not_implemented` default of `CoreApi`.

use std::sync::Arc;
use std::time::Duration;

use noter_core_harness::{serve, Lines, Output};
use noter_protocol::fixtures::world;
use noter_protocol::ipc::{Caller, CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::{
    Ack, AudioChannel, CoreError, ErrorCode, NoArgs, Seq, StateVersion, SubscriptionId,
};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, Lines as LineReader};
use tokio::task::JoinHandle;

struct Stub {
    lines: Lines,
}

impl CoreApi for Stub {
    async fn app_snapshot(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AppSnapshot, CoreError> {
        let mut app = world().app;
        if let Caller::Window { label } = ctx.caller {
            app.window = label;
        }
        Ok(app)
    }

    /// Slow on purpose: a later, faster request must not wait for it.
    async fn log_ui(&self, _ctx: &CommandCtx, _args: UiLogArgs) -> Result<Ack, CoreError> {
        tokio::time::sleep(Duration::from_millis(300)).await;
        Ok(Ack {})
    }

    /// Emits an event before it answers.
    async fn banner_dismiss(
        &self,
        _ctx: &CommandCtx,
        _args: BannerDismissArgs,
    ) -> Result<BannerSet, CoreError> {
        let set = BannerSet {
            version: StateVersion(2),
            banners: vec![],
        };
        self.lines
            .event("banners:changed", serde_json::to_value(&set).unwrap());
        Ok(set)
    }

    /// Sends three messages before it answers and one more afterwards; with `play_clip` it sends
    /// one and then refuses, so that message must never reach the wire.
    async fn self_test_run(
        &self,
        _ctx: &CommandCtx,
        args: SelfTestArgs,
        channel: Sink<SelfTestMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        let msg = |seq| SelfTestMsg {
            seq: Seq(seq),
            event: SelfTestEvent::StreamArrived {
                channel: AudioChannel::Mic,
            },
        };
        if args.play_clip {
            channel.send(msg(1));
            return Err(CoreError::new(ErrorCode::NotReady, "speech model"));
        }
        for seq in 1..=3 {
            channel.send(msg(seq));
        }
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            channel.send(msg(4));
        });
        Ok(SubscriptionHandle {
            subscription_id: SubscriptionId::new("sub_1"),
        })
    }
}

/// A test runner on the other end of the wire.
struct Runner {
    input: DuplexStream,
    output: LineReader<BufReader<DuplexStream>>,
    served: JoinHandle<std::io::Result<()>>,
}

fn start() -> Runner {
    let (input, core_in) = tokio::io::duplex(1 << 16);
    let (core_out, output) = tokio::io::duplex(1 << 16);
    let out = Output::new(core_out);
    let stub = Arc::new(Stub { lines: out.lines() });
    let served = tokio::spawn(serve(stub, core_in, out));
    Runner {
        input,
        output: BufReader::new(output).lines(),
        served,
    }
}

impl Runner {
    async fn send_raw(&mut self, line: &str) {
        self.input
            .write_all(format!("{line}\n").as_bytes())
            .await
            .unwrap();
    }

    async fn send(&mut self, req: Value) {
        self.send_raw(&req.to_string()).await;
    }

    async fn line(&mut self) -> Value {
        let line = tokio::time::timeout(Duration::from_secs(5), self.output.next_line())
            .await
            .expect("a line within 5 s")
            .unwrap()
            .expect("the harness is still writing");
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("not JSON: {line}"))
    }

    /// Ends stdin and returns every line written after it.
    async fn finish(mut self) -> Vec<Value> {
        self.input.shutdown().await.unwrap();
        drop(self.input);
        let mut rest = vec![];
        while let Some(line) = self.output.next_line().await.unwrap() {
            rest.push(serde_json::from_str(&line).unwrap());
        }
        self.served.await.unwrap().unwrap();
        rest
    }
}

fn request(id: u64, window: &str, cmd: &str, args: Value) -> Value {
    json!({ "id": id, "window": window, "cmd": cmd, "args": args, "channel": false })
}

// W1
#[tokio::test]
async fn app_snapshot_from_main_returns_ok_line() {
    let mut r = start();
    r.send(request(7, "main", "app_snapshot", json!({}))).await;
    let line = r.line().await;
    assert_eq!(line["id"], 7);
    assert_eq!(line["ok"]["window"], "main");
    assert!(line.get("error").is_none());
}

#[tokio::test]
async fn args_and_channel_may_be_left_out() {
    let mut r = start();
    r.send(json!({ "id": 1, "window": "settings", "cmd": "app_snapshot" }))
        .await;
    assert_eq!(r.line().await["ok"]["window"], "settings");
}

// W2
#[tokio::test]
async fn settings_only_command_from_call_screen_is_window_not_allowed() {
    let mut r = start();
    r.send(request(1, "call-screen", "hotkeys_list", json!({})))
        .await;
    let line = r.line().await;
    assert_eq!(line["id"], 1);
    assert_eq!(line["error"]["code"], "window_not_allowed");
}

// W3
#[tokio::test]
async fn scope_is_checked_before_arguments() {
    let mut r = start();
    r.send(request(
        1,
        "call-screen",
        "hotkey_set",
        json!({ "not": "an argument" }),
    ))
    .await;
    assert_eq!(r.line().await["error"]["code"], "window_not_allowed");
    r.send(request(
        2,
        "settings",
        "hotkey_set",
        json!({ "not": "an argument" }),
    ))
    .await;
    assert_eq!(r.line().await["error"]["code"], "invalid_input");
}

// W4
#[tokio::test]
async fn unparsable_line_is_invalid_input_and_serving_continues() {
    let mut r = start();
    r.send_raw("this is not json").await;
    let line = r.line().await;
    assert_eq!(line["id"], Value::Null);
    assert_eq!(line["error"]["code"], "invalid_input");
    r.send(json!({ "id": 3, "cmd": "app_snapshot" })).await; // no window
    let line = r.line().await;
    assert_eq!(line["id"], 3);
    assert_eq!(line["error"]["code"], "invalid_input");
    r.send(request(4, "main", "app_snapshot", json!({}))).await;
    assert_eq!(r.line().await["id"], 4);
}

#[tokio::test]
async fn bytes_that_are_not_utf8_are_an_unparsable_line() {
    let mut r = start();
    r.input.write_all(b"\xff\xfe\n").await.unwrap();
    assert_eq!(r.line().await["error"]["code"], "invalid_input");
    r.send(request(1, "main", "app_snapshot", json!({}))).await;
    assert_eq!(r.line().await["id"], 1);
}

// W5
#[tokio::test]
async fn unknown_command_is_invalid_input() {
    let mut r = start();
    r.send(request(1, "main", "no_such_command", json!({})))
        .await;
    let line = r.line().await;
    assert_eq!(line["error"]["code"], "invalid_input");
    assert_eq!(line["error"]["retryable"], false);
}

#[tokio::test]
async fn a_command_the_core_does_not_answer_yet_is_not_implemented() {
    let mut r = start();
    r.send(request(1, "settings", "hotkeys_list", json!({})))
        .await;
    assert_eq!(r.line().await["error"]["code"], "not_implemented");
}

// W6
#[tokio::test]
async fn channel_messages_follow_result_in_seq_order() {
    let mut r = start();
    r.send(json!({ "id": 9, "window": "first-run", "cmd": "self_test_run", "args": { "play_clip": false }, "channel": true })).await;
    let result = r.line().await;
    assert_eq!(result["id"], 9);
    assert_eq!(result["ok"]["subscription_id"], "sub_1");
    for seq in 1..=4 {
        let msg = r.line().await;
        assert_eq!(msg["id"], 9);
        assert_eq!(msg["message"]["seq"], seq);
    }
}

#[tokio::test]
async fn messages_of_a_refused_subscription_never_reach_the_wire() {
    let mut r = start();
    r.send(json!({ "id": 1, "window": "first-run", "cmd": "self_test_run", "args": { "play_clip": true }, "channel": true })).await;
    assert_eq!(r.line().await["error"]["code"], "not_ready");
    let rest = r.finish().await;
    assert!(rest.iter().all(|l| l.get("message").is_none()), "{rest:?}");
}

// W7
#[tokio::test]
async fn core_events_become_event_lines() {
    let mut r = start();
    r.send(request(
        1,
        "main",
        "banner_dismiss",
        json!({ "banner": "update_ready" }),
    ))
    .await;
    let event = r.line().await;
    assert_eq!(
        event,
        json!({ "event": "banners:changed", "payload": { "version": 2, "banners": [] } })
    );
    assert_eq!(r.line().await["ok"]["version"], 2);
}

// W8
#[tokio::test]
async fn concurrent_requests_are_answered_by_id() {
    let mut r = start();
    r.send(request(1, "main", "log_ui", json!({ "level": "error", "screen": "call_screen", "code": "engine_unavailable", "message": "banner shown" }))).await;
    r.send(request(2, "main", "app_snapshot", json!({}))).await;
    assert_eq!(r.line().await["id"], 2);
    let slow = r.line().await;
    assert_eq!(slow["id"], 1);
    assert_eq!(slow["ok"], json!({}));
}

#[tokio::test]
async fn end_of_input_waits_for_every_answer_then_ends() {
    let mut r = start();
    r.send(request(1, "main", "log_ui", json!({ "level": "error", "screen": "call_screen", "code": "engine_unavailable", "message": "banner shown" }))).await;
    let rest = r.finish().await;
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0]["id"], 1);
}
