//! Engine scripts (`.plans/engine-script-format.md`, TL-3): JSON Lines steps that run on tokio
//! time after the `ack` of the command they are bound to, every time it arrives.

use std::time::Duration;

use noter_engine_client::scripted::{Script, ScriptedEngine};
use noter_engine_client::{Config, EngineClient};
use noter_protocol::engine::{EngineCommand, EngineEvent};
use tokio::time::Instant;

const LEVELS: &str = r#"{"type": "levels", "call_id": null, "mic_db": -30.0, "sys_db": -40.0}"#;

fn levels() -> EngineEvent {
    EngineEvent::Levels {
        call_id: None,
        mic_db: -30.0,
        sys_db: -40.0,
    }
}

fn set_languages() -> EngineCommand {
    EngineCommand::SetLanguages { languages: vec![] }
}

#[test]
fn parse_skips_blank_and_comment_lines() {
    let text = format!(
        "// a call\n\n{{\"on\": \"set_languages\", \"after_ms\": 500, \"event\": {LEVELS}}}\n  // killed\n{{\"on\": \"ping\", \"after_ms\": 0, \"kill\": true}}\n"
    );
    assert_eq!(Script::parse(&text).unwrap().len(), 2);
    assert!(Script::parse("").unwrap().is_empty());
}

#[test]
fn parse_errors_name_the_first_bad_line() {
    let ok = format!(r#"{{"on": "set_languages", "after_ms": 0, "event": {LEVELS}}}"#);
    for bad in [
        "not json".to_string(),
        format!(r#"{{"on": "set_languages", "after_ms": 0, "event": {LEVELS}, "kill": true}}"#),
        r#"{"on": "set_languages", "after_ms": 0}"#.to_string(),
        r#"{"on": "set_languages", "after_ms": 0, "kill": false}"#.to_string(),
        r#"{"on": "stop_session", "after_ms": 0, "kill": true}"#.to_string(),
        r#"{"on": "set_languages", "after_ms": 0, "event": {"type": "levels"}}"#.to_string(),
        r#"{"on": "set_languages", "after_ms": 0, "kill": true, "extra": 1}"#.to_string(),
    ] {
        let err = Script::parse(&format!("// header\n{ok}\n{bad}\n{ok}\n")).unwrap_err();
        assert_eq!(err.line, 3, "{bad}: {err}");
        assert!(err.to_string().starts_with("line 3: "), "{err}");
    }
}

#[tokio::test(start_paused = true)]
async fn steps_run_after_the_ack_every_time_their_command_arrives() {
    let script = Script::parse(&format!(
        r#"{{"on": "set_languages", "after_ms": 500, "event": {LEVELS}}}"#
    ))
    .unwrap();
    let engine = ScriptedEngine::new().with_script(script);
    let c = EngineClient::new(engine.clone(), Config::default());
    let mut events = c.events();
    c.ensure_ready().await.unwrap();
    for _ in 0..2 {
        let start = Instant::now();
        c.command(set_languages()).await.unwrap();
        while events.recv().await.unwrap().event != levels() {}
        assert_eq!(start.elapsed(), Duration::from_millis(500));
    }
    c.command(EngineCommand::StopPlayback).await.unwrap();
    tokio::time::sleep(Duration::from_secs(5)).await;
    while let Ok(line) = events.try_recv() {
        assert_ne!(line.event, levels(), "nothing is bound to stop_playback");
    }
}

#[tokio::test(start_paused = true)]
async fn a_kill_step_ends_the_engine_at_its_time() {
    let script =
        Script::parse(r#"{"on": "set_languages", "after_ms": 9000, "kill": true}"#).unwrap();
    let engine = ScriptedEngine::new().with_script(script);
    let c = EngineClient::new(engine.clone(), Config::default());
    c.ensure_ready().await.unwrap();
    c.command(set_languages()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(8999)).await;
    assert!(engine.inject(levels()), "alive before its time");
    tokio::time::sleep(Duration::from_millis(2)).await;
    assert!(!engine.inject(levels()), "dead after it");
}
