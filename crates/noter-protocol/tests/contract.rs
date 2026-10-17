//! Contract tests: rules about the contract itself (DESIGN-core 4.1, Contract governance).

use std::collections::HashSet;

use noter_protocol::engine::{EngineEvent, EngineEventLine};
use noter_protocol::ipc::{command, CommandGroup, Stability, COMMANDS, EVENTS};
use noter_protocol::model::WindowLabel;
use noter_protocol::{fixtures, ErrorCode, TimestampMs};

#[test]
fn command_names_are_unique_snake_case_and_scoped() {
    let mut seen = HashSet::new();
    for c in COMMANDS {
        assert!(seen.insert(c.name), "duplicate command {}", c.name);
        assert!(
            c.name
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch == '_'),
            "not snake_case: {}",
            c.name
        );
        assert!(!c.windows.is_empty(), "{} has no window", c.name);
        assert!(
            c.doc.len() < 400,
            "{} doc too long for a manifest line",
            c.name
        );
    }
}

#[test]
fn every_ui_operation_group_has_commands() {
    use CommandGroup::*;
    for g in [
        App,
        CaptureControl,
        Transcript,
        Copilot,
        Items,
        Today,
        OutputsAndSharing,
        Handoff,
        LibraryAndAsk,
        HistoryAndUndo,
        People,
        Agents,
        SettingsAndCredentials,
        Performance,
        FirstRunAndPermissions,
        Windows,
    ] {
        assert!(
            COMMANDS.iter().any(|c| c.group == g),
            "group {g:?} has no command"
        );
    }
}

#[test]
fn window_scoping_matches_pm08() {
    // Only the Settings window and the first-run wizard can store a key.
    let c = command("api_key_set").unwrap();
    assert!(
        c.windows
            .iter()
            .all(|w| matches!(w, WindowLabel::Settings | WindowLabel::FirstRun)),
        "api_key_set"
    );
    // The call window never deletes calls, stores keys or changes settings.
    for name in [
        "calls_delete",
        "api_key_set",
        "api_key_remove",
        "settings_update",
        "audio_delete",
        "person_delete",
    ] {
        assert!(
            !command(name).unwrap().allows(WindowLabel::CallScreen),
            "{name} must not be callable from the call window"
        );
    }
    // The record prompt can start capture and dismiss itself, nothing destructive.
    let prompt: Vec<_> = COMMANDS
        .iter()
        .filter(|c| c.allows(WindowLabel::RecordPrompt))
        .map(|c| c.name)
        .collect();
    for forbidden in ["calls_delete", "capture_discard", "settings_update"] {
        assert!(
            !prompt.contains(&forbidden),
            "record prompt must not call {forbidden}"
        );
    }
    assert!(prompt.contains(&"capture_start"));
}

#[test]
fn copilot_agents_and_performance_are_draft() {
    for c in COMMANDS {
        if matches!(
            c.group,
            CommandGroup::Copilot | CommandGroup::Agents | CommandGroup::Performance
        ) {
            assert_eq!(
                c.stability,
                Stability::Draft,
                "{} should be draft until its milestone gate",
                c.name
            );
        }
    }
}

#[test]
fn subscribing_commands_use_channels() {
    let subs: Vec<_> = COMMANDS
        .iter()
        .filter(|c| c.channel.is_some())
        .map(|c| c.name)
        .collect();
    for expected in [
        "transcript_subscribe",
        "levels_subscribe",
        "cards_subscribe",
        "ask_start",
        "self_test_run",
    ] {
        assert!(
            subs.contains(&expected),
            "{expected} must deliver over a Channel"
        );
    }
}

#[test]
fn event_names_are_unique_area_colon_what() {
    let mut seen = HashSet::new();
    for e in EVENTS {
        assert!(seen.insert(e.name), "duplicate event {}", e.name);
        let (area, what) = e.name.split_once(':').expect("area:what");
        assert!(!area.is_empty() && !what.is_empty());
        assert!(
            e.name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c == ':' || c == '_'),
            "{}",
            e.name
        );
    }
}

#[test]
fn error_codes_are_unique_and_complete() {
    let mut seen = HashSet::new();
    for c in ErrorCode::ALL {
        let s = serde_json::to_value(c).unwrap();
        assert!(
            seen.insert(s.as_str().unwrap().to_string()),
            "duplicate {s}"
        );
    }
    // Completeness: the exported union has exactly as many members as ALL.
    let types = specta::Types::default().register::<ErrorCode>();
    let ts = specta_typescript::Typescript::default()
        .export(&types, specta_serde::Format)
        .unwrap();
    let union = ts.split("export type ErrorCode").nth(1).unwrap();
    let union = union.split("\n\n").next().unwrap();
    let members = union
        .lines()
        .filter(|l| l.trim_start().starts_with('"'))
        .count();
    assert_eq!(
        members,
        ErrorCode::ALL.len(),
        "ErrorCode::ALL is missing a variant"
    );
}

#[test]
fn fixtures_round_trip() {
    let world = fixtures::world();
    let json = serde_json::to_string(&world).unwrap();
    let back: fixtures::FakeWorld = serde_json::from_str(&json).unwrap();
    assert_eq!(world, back);
    assert_eq!(world.app.contract_version, noter_protocol::CONTRACT_VERSION);
    // Snapshot then stream: the fixture transcript says where the stream starts.
    assert!(world.transcripts.iter().all(|t| t.last_seq.0 > 0));
}

#[test]
fn engine_lines_have_the_documented_shape() {
    let line = EngineEventLine {
        seq: 7,
        at: TimestampMs(1),
        event: EngineEvent::Pong,
    };
    let v = serde_json::to_value(&line).unwrap();
    assert_eq!(v["seq"], 7);
    assert_eq!(v["event"]["type"], "pong");
    let parsed: EngineEventLine = serde_json::from_str(
        r#"{"seq":8,"at":2,"event":{"type":"call_audio_released","bundle_id":"us.zoom.xos"}}"#,
    )
    .unwrap();
    assert!(matches!(
        parsed.event,
        EngineEvent::CallAudioReleased { .. }
    ));
}

#[test]
fn wire_format_is_snake_case_with_type_tags() {
    let v = serde_json::to_value(noter_protocol::Provenance::ModelGuess).unwrap();
    assert_eq!(v["type"], "model_guess");
    let w = serde_json::to_value(WindowLabel::CallScreen).unwrap();
    assert_eq!(w, "call-screen");
    assert_eq!(WindowLabel::CallScreen.as_str(), "call-screen");
}
