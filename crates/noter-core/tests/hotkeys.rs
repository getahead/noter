//! FEATURE cpt-noter-feature-core-settings: app hotkeys registered at launch, set, cleared and
//! reset, with chords checked against missing modifiers, reserved chords and conflicts.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};

use noter_core::{
    Clock, Core, CoreDeps, EventEmitter, ShortcutRegistrar, ShortcutTaken, DEFAULT_HOTKEYS,
};
use noter_db::rusqlite::Connection;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, CoreApi};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

#[derive(Default)]
struct Events(Mutex<Vec<(&'static str, Value)>>);

impl EventEmitter for Events {
    fn emit(&self, event: &'static str, payload: Value) {
        self.0.lock().unwrap().push((event, payload));
    }
}

impl Events {
    fn names(&self) -> Vec<&'static str> {
        std::mem::take(&mut *self.0.lock().unwrap())
            .into_iter()
            .map(|(n, _)| n)
            .collect()
    }
}

struct FixedClock;

impl Clock for FixedClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}

/// macOS as the harness scripts it: chords other apps hold, and what Noter registered.
#[derive(Default)]
struct Shortcuts {
    held_by_others: HashMap<String, Option<String>>,
    registered: Mutex<BTreeSet<String>>,
}

impl ShortcutRegistrar for Shortcuts {
    fn register(&self, chord: &str) -> Result<(), ShortcutTaken> {
        if let Some(owner) = self.held_by_others.get(chord) {
            return Err(ShortcutTaken {
                owner: owner.clone(),
            });
        }
        self.registered.lock().unwrap().insert(chord.to_string());
        Ok(())
    }
    fn unregister(&self, chord: &str) {
        self.registered.lock().unwrap().remove(chord);
    }
}

impl Shortcuts {
    fn held(chords: &[(&str, &str)]) -> Self {
        let held_by_others = chords
            .iter()
            .map(|(c, o)| (c.to_string(), Some(o.to_string())))
            .collect();
        Shortcuts {
            held_by_others,
            ..Default::default()
        }
    }
    fn registered(&self) -> BTreeSet<String> {
        self.registered.lock().unwrap().clone()
    }
}

fn open_with(dir: &Path, shortcuts: Arc<Shortcuts>) -> (Core, Arc<Events>) {
    let events = Arc::new(Events::default());
    let deps = CoreDeps::new(Arc::new(FixedClock), events.clone()).with_shortcuts(shortcuts);
    (Core::open(dir, deps).expect("core opens"), events)
}

fn settings() -> CommandCtx {
    CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Settings,
        },
    }
}

fn set(action: HotkeyAction, shortcut: Option<&str>) -> HotkeySetArgs {
    HotkeySetArgs {
        action,
        shortcut: shortcut.map(String::from),
    }
}

fn binding(list: &HotkeyList, action: HotkeyAction) -> HotkeyBinding {
    list.bindings
        .iter()
        .find(|b| b.action == action)
        .unwrap()
        .clone()
}

fn owner(err: &CoreError) -> Option<String> {
    match &err.detail {
        Some(ErrorDetail::HotkeyOwner { owner }) => owner.clone(),
        _ => None,
    }
}

fn change_count(dir: &Path) -> i64 {
    let c = Connection::open(dir.join("noter.db")).unwrap();
    c.query_row("SELECT count(*) FROM changes", [], |r| r.get(0))
        .unwrap()
}

fn app_chords() -> BTreeSet<String> {
    DEFAULT_HOTKEYS
        .iter()
        .filter(|(action, _)| *action != HotkeyAction::UndoCardAction)
        .map(|(_, chord)| chord.to_string())
        .collect()
}

#[tokio::test]
async fn app_hotkeys_are_registered_at_launch_with_their_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::default());
    let (core, _) = open_with(dir.path(), shortcuts.clone());
    let list = core.hotkeys_list(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(list.version, StateVersion(1));
    let actions: Vec<HotkeyAction> = list.bindings.iter().map(|b| b.action).collect();
    let defaults: Vec<HotkeyAction> = DEFAULT_HOTKEYS.iter().map(|(a, _)| *a).collect();
    assert_eq!(actions, defaults);
    for b in &list.bindings {
        assert_eq!(b.shortcut, b.default_shortcut);
        let expected = if b.action == HotkeyAction::UndoCardAction {
            HotkeyStatus::RegisteredDuringCapture
        } else {
            HotkeyStatus::Registered
        };
        assert_eq!(b.status, expected, "{:?}", b.action);
    }
    assert_eq!(
        shortcuts.registered(),
        app_chords(),
        "the card key waits for capture (copilot, M4)"
    );
    let mute = binding(&list, HotkeyAction::MuteCopilot).shortcut;
    assert_eq!(mute.as_deref(), Some("Ctrl+Alt+Super+K"));
}

#[tokio::test]
async fn a_chord_another_app_holds_at_launch_is_a_conflict_and_degraded() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::held(&[("Ctrl+Alt+Super+A", "Raycast")]));
    let (core, events) = open_with(dir.path(), shortcuts.clone());
    let list = core.hotkeys_list(&settings(), NoArgs {}).await.unwrap();
    let ask = binding(&list, HotkeyAction::AskAboutCall);
    assert_eq!(
        ask.status,
        HotkeyStatus::Conflict {
            owner: Some("Raycast".into())
        }
    );
    let snap = core.app_snapshot(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        snap.degraded.states,
        [DegradedState::HotkeyNotRegistered {
            action: HotkeyAction::AskAboutCall
        }]
    );
    assert!(!shortcuts.registered().contains("Ctrl+Alt+Super+A"));
    events.names();

    // A new chord resolves it and leaves the degraded set.
    let args = set(HotkeyAction::AskAboutCall, Some("Ctrl+Alt+Super+I"));
    let list = core.hotkey_set(&settings(), args).await.unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::AskAboutCall).status,
        HotkeyStatus::Registered
    );
    let snap = core.app_snapshot(&settings(), NoArgs {}).await.unwrap();
    assert!(snap.degraded.states.is_empty());
    assert_eq!(
        events.names(),
        [event_names::DEGRADED_CHANGED, event_names::HOTKEYS_CHANGED]
    );
}

#[tokio::test]
async fn a_new_chord_is_registered_the_old_one_released_and_kept() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::default());
    let (core, events) = open_with(dir.path(), shortcuts.clone());
    let args = set(HotkeyAction::CatchMeUp, Some("Ctrl+Alt+Super+U"));
    let list = core.hotkey_set(&settings(), args).await.unwrap();
    let catch_up = binding(&list, HotkeyAction::CatchMeUp);
    assert_eq!(
        (catch_up.shortcut.as_deref(), catch_up.status),
        (Some("Ctrl+Alt+Super+U"), HotkeyStatus::Registered)
    );
    assert_eq!(
        catch_up.default_shortcut.as_deref(),
        Some("Ctrl+Alt+Super+C")
    );
    assert_eq!(list.version, StateVersion(2));
    assert_eq!(events.names(), [event_names::HOTKEYS_CHANGED]);
    let registered = shortcuts.registered();
    assert!(registered.contains("Ctrl+Alt+Super+U") && !registered.contains("Ctrl+Alt+Super+C"));
    // Hotkeys never move the settings rev (D2), and the write is logged.
    assert_eq!(
        core.settings_get(&settings(), NoArgs {}).await.unwrap().rev,
        Rev(1)
    );
    assert_eq!(change_count(dir.path()), 1);

    core.shutdown().await;
    drop(core);
    let again = Arc::new(Shortcuts::default());
    let (core, _) = open_with(dir.path(), again.clone());
    let list = core.hotkeys_list(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::CatchMeUp).shortcut.as_deref(),
        Some("Ctrl+Alt+Super+U")
    );
    assert!(again.registered().contains("Ctrl+Alt+Super+U"));
}

#[tokio::test]
async fn chords_without_a_modifier_or_reserved_by_the_system_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), Arc::new(Shortcuts::default()));
    let bare = core
        .hotkey_set(&settings(), set(HotkeyAction::OpenCallScreen, Some("N")))
        .await
        .unwrap_err();
    let rule = match bare.detail {
        Some(ErrorDetail::Validation { field, rule }) => Some((field, rule)),
        _ => None,
    };
    assert_eq!(
        (bare.code, rule),
        (
            ErrorCode::InvalidInput,
            Some(("shortcut".into(), ValidationRule::NoModifier))
        )
    );
    let quit = core
        .hotkey_set(&settings(), set(HotkeyAction::Pause, Some("Super+Q")))
        .await
        .unwrap_err();
    assert_eq!(
        (quit.code, owner(&quit).as_deref()),
        (ErrorCode::HotkeyReserved, Some("macOS"))
    );
    let voice_over = core
        .hotkey_set(&settings(), set(HotkeyAction::Pause, Some("cmd+f5")))
        .await
        .unwrap_err();
    assert_eq!(
        (voice_over.code, owner(&voice_over).as_deref()),
        (ErrorCode::HotkeyReserved, Some("VoiceOver"))
    );
    let list = core.hotkeys_list(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::Pause).shortcut.as_deref(),
        Some("Ctrl+Alt+Super+P")
    );
    assert_eq!(change_count(dir.path()), 0);
}

#[tokio::test]
async fn a_chord_in_use_is_a_conflict_naming_its_owner_and_the_old_chord_stays() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::held(&[("Ctrl+Alt+Super+Y", "Raycast")]));
    let (core, _) = open_with(dir.path(), shortcuts.clone());
    let w = settings();
    let ours = core
        .hotkey_set(&w, set(HotkeyAction::Pause, Some("super+ctrl+alt+r")))
        .await
        .unwrap_err();
    assert_eq!(
        (ours.code, owner(&ours).as_deref()),
        (ErrorCode::HotkeyConflict, Some("start_stop"))
    );
    let card = core
        .hotkey_set(&w, set(HotkeyAction::Pause, Some("Ctrl+Alt+Super+2")))
        .await
        .unwrap_err();
    assert_eq!(
        (card.code, owner(&card).as_deref()),
        (ErrorCode::HotkeyConflict, Some("card keys"))
    );
    let dismiss = core
        .hotkey_set(&w, set(HotkeyAction::Pause, Some("Ctrl+Alt+Super+Shift+3")))
        .await
        .unwrap_err();
    assert_eq!(owner(&dismiss).as_deref(), Some("card keys"));
    let raycast = core
        .hotkey_set(&w, set(HotkeyAction::Pause, Some("Ctrl+Alt+Super+Y")))
        .await
        .unwrap_err();
    assert_eq!(
        (raycast.code, owner(&raycast).as_deref()),
        (ErrorCode::HotkeyConflict, Some("Raycast"))
    );
    assert!(
        shortcuts.registered().contains("Ctrl+Alt+Super+P"),
        "the old chord stays registered"
    );
    // The same chord again is not a conflict with itself.
    core.hotkey_set(&w, set(HotkeyAction::Pause, Some("Ctrl+Alt+Super+P")))
        .await
        .unwrap();
    assert!(shortcuts.registered().contains("Ctrl+Alt+Super+P"));
}

#[tokio::test]
async fn a_cleared_hotkey_is_released_and_can_be_set_again() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::default());
    let (core, _) = open_with(dir.path(), shortcuts.clone());
    let w = settings();
    let list = core
        .hotkey_set(&w, set(HotkeyAction::MarkMoment, None))
        .await
        .unwrap();
    let mark = binding(&list, HotkeyAction::MarkMoment);
    assert_eq!((mark.shortcut, mark.status), (None, HotkeyStatus::NotSet));
    assert!(!shortcuts.registered().contains("Ctrl+Alt+Super+M"));
    let list = core
        .hotkey_set(&w, set(HotkeyAction::MarkMoment, Some("Ctrl+Alt+Super+J")))
        .await
        .unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::MarkMoment).status,
        HotkeyStatus::Registered
    );
    // The card key is registered by the copilot while capture runs, not here.
    let list = core
        .hotkey_set(
            &w,
            set(HotkeyAction::UndoCardAction, Some("Ctrl+Alt+Super+X")),
        )
        .await
        .unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::UndoCardAction).status,
        HotkeyStatus::RegisteredDuringCapture
    );
    assert!(!shortcuts.registered().contains("Ctrl+Alt+Super+X"));
}

#[tokio::test]
async fn a_stored_chord_the_system_now_reserves_is_listed_as_reserved() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), Arc::new(Shortcuts::default()));
    core.shutdown().await;
    drop(core);
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    let stored = json!({ "start_stop": "Super+Space" }).to_string();
    c.execute(
        "INSERT INTO settings (key, value) VALUES ('hotkeys', ?1)",
        [stored],
    )
    .unwrap();
    drop(c);
    let shortcuts = Arc::new(Shortcuts::default());
    let (core, _) = open_with(dir.path(), shortcuts.clone());
    let list = core.hotkeys_list(&settings(), NoArgs {}).await.unwrap();
    assert_eq!(
        binding(&list, HotkeyAction::StartStop).status,
        HotkeyStatus::ReservedBySystem
    );
    assert!(!shortcuts.registered().contains("Super+Space"));
    assert_eq!(
        binding(&list, HotkeyAction::Pause).status,
        HotkeyStatus::Registered,
        "others keep their defaults"
    );
}

#[tokio::test]
async fn reset_restores_every_hotkey_and_the_card_keys() {
    let dir = tempfile::tempdir().unwrap();
    let shortcuts = Arc::new(Shortcuts::default());
    let (core, events) = open_with(dir.path(), shortcuts.clone());
    let w = settings();
    core.hotkey_set(&w, set(HotkeyAction::CatchMeUp, Some("Ctrl+Alt+Super+U")))
        .await
        .unwrap();
    let mut copilot = noter_core::default_settings().copilot;
    copilot.card_keys.modifiers = Modifiers {
        control: true,
        option: false,
        command: true,
    };
    copilot.dismiss_with_keys = true;
    let section = SettingsSection::Copilot(copilot);
    core.settings_update(
        &w,
        SettingsUpdateArgs {
            rev: Rev(1),
            section,
        },
    )
    .await
    .unwrap();
    events.names();
    let before = change_count(dir.path());

    let list = core.hotkeys_reset(&w, NoArgs {}).await.unwrap();
    assert!(list
        .bindings
        .iter()
        .all(|b| b.shortcut == b.default_shortcut));
    assert_eq!(shortcuts.registered(), app_chords());
    let s = core.settings_get(&w, NoArgs {}).await.unwrap();
    let card_keys = noter_core::default_settings().copilot.card_keys;
    assert_eq!(
        (s.rev, s.copilot.card_keys, s.copilot.dismiss_with_keys),
        (Rev(3), card_keys, false)
    );
    assert_eq!(
        events.names(),
        [event_names::SETTINGS_CHANGED, event_names::HOTKEYS_CHANGED]
    );
    // One batch: the bindings and the card keys.
    assert_eq!(change_count(dir.path()) - before, 2);
    let c = Connection::open(dir.path().join("noter.db")).unwrap();
    let batches: i64 = c
        .query_row(
            "SELECT count(DISTINCT batch_id) FROM changes WHERE reason = 'hotkeys_reset'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(batches, 1);
}

#[tokio::test]
async fn only_the_settings_window_sets_hotkeys() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), Arc::new(Shortcuts::default()));
    let main = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let args = json!({ "action": "pause", "shortcut": "Ctrl+Alt+Super+Y" });
    let err = dispatch_json(&core, &main, "hotkey_set", args, None)
        .await
        .unwrap_err();
    assert_eq!(err.code, ErrorCode::WindowNotAllowed);
}

#[test]
fn the_default_registrar_accepts_every_chord() {
    let deps = CoreDeps::new(Arc::new(FixedClock), Arc::new(Events::default()));
    assert!(deps.shortcuts.register("Ctrl+Alt+Super+R").is_ok());
    deps.shortcuts.unregister("Ctrl+Alt+Super+R");
}

fn native_command(core: &Core, chord: &str) -> Result<(&'static str, Value), ErrorCode> {
    match core.hotkey_command(chord) {
        Ok((ctx, command, args)) => {
            assert_eq!(
                ctx.caller,
                Caller::Native {
                    surface: noter_protocol::ipc::NativeSurface::Hotkey
                }
            );
            Ok((command, args))
        }
        Err(e) => Err(e.code),
    }
}

#[tokio::test]
async fn a_pressed_hotkey_asks_the_core_as_a_native_caller() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), Arc::new(Shortcuts::default()));
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+N"),
        Ok(("window_show_call", json!({})))
    );
    assert_eq!(
        native_command(&core, "super+ctrl+alt+n"),
        Ok(("window_show_call", json!({}))),
        "any spelling"
    );
    let start = json!({ "source": "hotkey", "sensitive": false });
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+R"),
        Ok(("capture_start", start))
    );
    let hide = json!({ "hidden": true });
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+0"),
        Ok(("app_set_hidden_for_presenting", hide))
    );
    // Nothing is recorded, so the call's own keys have nothing to act on.
    for chord in [
        "Ctrl+Alt+Super+P",
        "Ctrl+Alt+Super+M",
        "Ctrl+Alt+Super+C",
        "Ctrl+Alt+Super+K",
        "Ctrl+Alt+Super+Z",
    ] {
        assert_eq!(
            native_command(&core, chord),
            Err(ErrorCode::NotRecording),
            "{chord}"
        );
    }
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+A"),
        Err(ErrorCode::NotImplemented),
        "Ask needs its panel (M3)"
    );
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+Q"),
        Err(ErrorCode::NotFound)
    );
    // A cleared hotkey no longer answers.
    core.hotkey_set(&settings(), set(HotkeyAction::OpenCallScreen, None))
        .await
        .unwrap();
    assert_eq!(
        native_command(&core, "Ctrl+Alt+Super+N"),
        Err(ErrorCode::NotFound)
    );
}

#[tokio::test]
async fn a_hotkey_press_runs_its_command_through_the_core() {
    let dir = tempfile::tempdir().unwrap();
    let (core, _) = open_with(dir.path(), Arc::new(Shortcuts::default()));
    // The key is the command: Open Call Screen shows the call window through the core.
    let shown = core.hotkey_pressed("Ctrl+Alt+Super+N").await.unwrap();
    assert_eq!(shown["visible"], true);
}
