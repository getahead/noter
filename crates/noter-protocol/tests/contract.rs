//! Contract tests: rules about the contract itself (DESIGN-core 4.1, Contract governance).

// @cpt-algo:cpt-noter-algo-core-contract-tests:p1

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

/// Walks every named type an argument type can contain and returns the `Option` fields that
/// lack `#[serde(default)]` (BA18). Such a field is required on the wire even though its type
/// says it may be absent, so a UI that omits it gets `invalid_input`.
fn option_fields_without_default(types: &specta::Types) -> Vec<String> {
    use specta::datatype::{DataType, Fields};
    fn check(owner: &str, fields: &Fields, container_default: bool, out: &mut Vec<String>) {
        if let Fields::Named(named) = fields {
            for (name, field) in &named.fields {
                let nullable = matches!(field.ty, Some(DataType::Nullable(_)));
                let default =
                    container_default || field.attributes.contains_key("serde:field:default");
                if nullable && !default {
                    out.push(format!("{owner}.{name}"));
                }
            }
        }
    }
    let mut out = Vec::new();
    for ndt in types.into_unsorted_iter() {
        match &ndt.ty {
            Some(DataType::Struct(st)) => {
                let container_default = st.attributes.contains_key("serde:container:default");
                check(&ndt.name, &st.fields, container_default, &mut out);
            }
            Some(DataType::Enum(en)) => {
                for (variant, v) in &en.variants {
                    check(
                        &format!("{}::{}", ndt.name, variant),
                        &v.fields,
                        false,
                        &mut out,
                    );
                }
            }
            _ => {}
        }
    }
    out.sort();
    out
}

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-serde-default
#[test]
fn every_option_field_of_an_argument_type_has_serde_default() {
    let types = noter_protocol::ipc::register_arg_types(specta::Types::default());
    let missing = option_fields_without_default(&types);
    assert!(missing.is_empty(), "add #[serde(default)] to: {missing:#?}");
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-serde-default

#[test]
fn option_fields_without_default_parse_when_absent() {
    // The attribute the test above reads really makes serde accept an absent field.
    let v: noter_protocol::model::CaptureStartArgs =
        serde_json::from_str(r#"{"source":"hotkey","sensitive":false}"#).unwrap();
    assert!(v.detection_id.is_none() && v.calendar_event_id.is_none());
}

#[test]
fn whole_state_events_carry_a_version() {
    use specta::datatype::{DataType, Fields};
    // Events that carry one record or one step, not a whole state.
    let not_whole_state = [
        "entity:changed",
        "outputs:progress",
        "jobs:progress",
        "signin:progress",
        "nav:request",
    ];
    let types = noter_protocol::ipc::ipc_types();
    for e in EVENTS.iter().filter(|e| !not_whole_state.contains(&e.name)) {
        let ndt = types
            .into_unsorted_iter()
            .find(|t| t.name == e.payload)
            .unwrap_or_else(|| panic!("{} payload {} not exported", e.name, e.payload));
        let has_version = match &ndt.ty {
            Some(DataType::Struct(st)) => match &st.fields {
                Fields::Named(n) => n.fields.iter().any(|(name, _)| name == "version"),
                _ => false,
            },
            _ => false,
        };
        assert!(
            has_version,
            "{} ({}) is a whole-state payload without `version`",
            e.name, e.payload
        );
    }
}

#[test]
fn stability_per_name() {
    // Draft until their milestone gate or v1.x; everything else named here is frozen.
    for (name, stability) in [
        ("storage_move", Stability::Draft),
        ("context_chip_set", Stability::Draft),
        ("card_unpin", Stability::Draft),
        ("cards_subscribe", Stability::Draft),
        ("capture_start", Stability::Frozen),
        ("capture_hold_notice", Stability::Frozen),
        ("capture_keep_recording", Stability::Frozen),
        ("capture_keep_source", Stability::Frozen),
        ("capture_resume_interrupted", Stability::Frozen),
        ("banner_dismiss", Stability::Frozen),
        ("stream_ack", Stability::Frozen),
        ("change_redo", Stability::Frozen),
        ("hotkeys_reset", Stability::Frozen),
        ("job_cancel", Stability::Frozen),
        ("handoff_cancel", Stability::Frozen),
        ("window_report_view", Stability::Frozen),
    ] {
        assert_eq!(
            command(name)
                .unwrap_or_else(|| panic!("no command {name}"))
                .stability,
            stability,
            "{name}"
        );
    }
    let event = |n: &str| EVENTS.iter().find(|e| e.name == n).unwrap().stability;
    assert_eq!(event("copilot:status"), Stability::Draft);
    assert_eq!(event("capture:state"), Stability::Frozen);
    assert_eq!(event("degraded:changed"), Stability::Frozen);
}

#[test]
fn window_scopes_from_the_review() {
    let allows = |n: &str, w: WindowLabel| command(n).unwrap().allows(w);
    assert!(allows("item_reopen", WindowLabel::CallScreen));
    for w in [
        WindowLabel::FirstRun,
        WindowLabel::Main,
        WindowLabel::Settings,
    ] {
        assert!(
            allows("account_test", w) && allows("account_sign_out", w),
            "{w:?}"
        );
    }
    assert!(allows("capture_hold_notice", WindowLabel::RecordPrompt));
    assert!(
        allows("window_report_view", WindowLabel::Main)
            && !allows("window_report_view", WindowLabel::CallScreen)
    );
    for w in WindowLabel::ALL {
        assert!(allows("stream_ack", w), "stream_ack from {w:?}");
    }
}

#[test]
fn capture_start_is_never_gated_on_setup() {
    // O1: no setup or permission code exists that capture_start could raise.
    let codes: Vec<String> = ErrorCode::ALL
        .iter()
        .map(|c| {
            serde_json::to_value(c)
                .unwrap()
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    for gone in [
        "setup_incomplete",
        "disk_low",
        "partially_applied",
        "model_not_ready",
    ] {
        assert!(!codes.iter().any(|c| c == gone), "{gone} must not exist");
    }
    for needed in [
        "already_recording",
        "disk_full",
        "model_missing",
        "already_undone",
        "not_undone",
        "not_undoable",
        "edited_later",
        "calendar_unavailable",
        "tracker_unreachable",
    ] {
        assert!(codes.iter().any(|c| c == needed), "{needed} is missing");
    }
}

#[test]
fn lang_other_round_trips_as_an_object() {
    use noter_protocol::Lang;
    assert_eq!(serde_json::to_value(Lang::Ru).unwrap(), "ru");
    let fr = Lang::Other { code: "fr".into() };
    let v = serde_json::to_value(&fr).unwrap();
    assert_eq!(v["code"], "fr");
    assert_eq!(serde_json::from_value::<Lang>(v).unwrap(), fr);
    assert_eq!(serde_json::from_str::<Lang>("\"de\"").unwrap(), Lang::De);
}

fn repo_file(rel: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn code_name(c: &ErrorCode) -> String {
    serde_json::to_value(c)
        .unwrap()
        .as_str()
        .unwrap()
        .to_string()
}

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-names
#[test]
fn channel_message_types_are_unique() {
    let mut seen = HashSet::new();
    for c in COMMANDS {
        if let Some(chan) = c.channel {
            assert!(seen.insert(chan), "{} reuses Channel {chan}", c.name);
        }
    }
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-names

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-stability
#[test]
fn draft_surfaces_are_exactly_copilot_agents_performance_and_storage_move() {
    // Everything not named draft by DESIGN-core 4.1 is frozen.
    for c in COMMANDS {
        let draft = matches!(
            c.group,
            CommandGroup::Copilot | CommandGroup::Agents | CommandGroup::Performance
        ) || c.name == "storage_move";
        let want = if draft {
            Stability::Draft
        } else {
            Stability::Frozen
        };
        assert_eq!(c.stability, want, "{}", c.name);
    }
    for e in EVENTS {
        let want = if e.name == "copilot:status" {
            Stability::Draft
        } else {
            Stability::Frozen
        };
        assert_eq!(e.stability, want, "{}", e.name);
    }
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-stability

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-scopes
#[test]
fn the_call_window_never_deletes() {
    for c in COMMANDS {
        let deletes = c.name.ends_with("_delete")
            || c.name.contains("_delete_")
            || c.name.ends_with("_remove")
            || c.result.starts_with("Delete");
        assert!(
            !(deletes && c.allows(WindowLabel::CallScreen)),
            "{} deletes and must not be callable from the call window",
            c.name
        );
    }
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-scopes

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-errors
#[test]
fn error_codes_are_the_closed_list_of_design_core() {
    // DESIGN-core 3.3 › Error codes: one table row per code and the retryable-by-default list.
    let design = repo_file("docs/DESIGN-core.md");
    let section = design
        .split("**Error codes.**")
        .nth(1)
        .expect("DESIGN-core 3.3 has an Error codes paragraph");
    let (intro, table) = section.split_once("\n\n").unwrap();
    let table = table.split("\n\n").next().unwrap();
    let documented: HashSet<String> = table
        .lines()
        .filter_map(|l| l.strip_prefix("| `"))
        .map(|l| l.split('`').next().unwrap().to_string())
        .collect();
    let ours: HashSet<String> = ErrorCode::ALL.iter().map(code_name).collect();
    assert_eq!(ours.len(), ErrorCode::ALL.len());
    let missing: Vec<_> = documented.difference(&ours).collect();
    let extra: Vec<_> = ours.difference(&documented).collect();
    assert!(
        missing.is_empty() && extra.is_empty(),
        "not in ErrorCode: {missing:?}; not in DESIGN-core 3.3: {extra:?}"
    );

    let retryable_doc: HashSet<String> = intro
        .split("`DEFAULT_RETRYABLE` says:")
        .nth(1)
        .expect("DESIGN-core 3.3 lists the retryable codes")
        .split('`')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect();
    let retryable: HashSet<String> = ErrorCode::ALL
        .iter()
        .filter(|c| c.default_retryable())
        .map(code_name)
        .collect();
    assert_eq!(
        retryable, retryable_doc,
        "default_retryable differs from DESIGN-core 3.3"
    );
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-errors

// @cpt-begin:cpt-noter-algo-core-contract-tests:p1:inst-check-roundtrip
#[test]
fn the_fixture_file_round_trips_through_the_types() {
    let file: fixtures::FakeWorld =
        serde_json::from_str(&repo_file("contracts/fixtures/world.json")).unwrap();
    assert_eq!(file, fixtures::world());
}
// @cpt-end:cpt-noter-algo-core-contract-tests:p1:inst-check-roundtrip
