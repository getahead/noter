//! App hotkeys: registered at launch through the host's global-shortcut registrar, checked
//! for missing modifiers, reserved chords and conflicts, stored in the `hotkeys` settings row
//! (which never moves the settings `rev`).

use std::sync::MutexGuard;

use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{dispatch_json, event_names, Caller, CommandCtx, NativeSurface};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use crate::settings::{current_rev, default_card_keys, invalid, put, section_of};
use crate::{internal, lock, Core};

/// The host's global shortcuts (the Tauri global-shortcut plugin in the app, a scripted one in
/// the harness). A registered chord's press calls the core as `Caller::Native { surface: hotkey }`.
pub trait ShortcutRegistrar: Send + Sync {
    fn register(&self, chord: &str) -> Result<(), ShortcutTaken>;
    fn unregister(&self, chord: &str);
}

/// macOS refused a chord: another app holds it (its name when macOS says).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShortcutTaken {
    pub owner: Option<String>,
}

/// A registrar that accepts every chord, until the host provides its own.
pub(crate) struct AcceptAll;

impl ShortcutRegistrar for AcceptAll {
    fn register(&self, _chord: &str) -> Result<(), ShortcutTaken> {
        Ok(())
    }
    fn unregister(&self, _chord: &str) {}
}

/// Default chords in list order (PRD › 14 Settings › Hotkeys; the fake core's world uses the same).
pub const DEFAULT_HOTKEYS: [(HotkeyAction, &str); 9] = [
    (HotkeyAction::StartStop, "Ctrl+Alt+Super+R"),
    (HotkeyAction::OpenCallScreen, "Ctrl+Alt+Super+N"),
    (HotkeyAction::Pause, "Ctrl+Alt+Super+P"),
    (HotkeyAction::MarkMoment, "Ctrl+Alt+Super+M"),
    (HotkeyAction::CatchMeUp, "Ctrl+Alt+Super+C"),
    (HotkeyAction::AskAboutCall, "Ctrl+Alt+Super+A"),
    (HotkeyAction::HideForPresenting, "Ctrl+Alt+Super+0"),
    (HotkeyAction::MuteCopilot, "Ctrl+Alt+Super+K"),
    (HotkeyAction::UndoCardAction, "Ctrl+Alt+Super+Z"),
];

/// Chords macOS and VoiceOver keep for themselves, with their owner.
const RESERVED: [(&str, &str); 11] = [
    ("Super+Q", "macOS"),
    ("Super+W", "macOS"),
    ("Super+H", "macOS"),
    ("Super+M", "macOS"),
    ("Super+Tab", "macOS"),
    ("Super+Space", "macOS"),
    ("Ctrl+Super+Q", "macOS"),
    ("Shift+Super+3", "macOS"),
    ("Shift+Super+4", "macOS"),
    ("Super+F5", "VoiceOver"),
    ("Alt+Super+F5", "VoiceOver"),
];

/// A chord as modifiers (control, option, shift, command) and one key, whatever its spelling.
type Chord = ([bool; 4], String);

fn parse(chord: &str) -> Chord {
    let mut mods = [false; 4];
    let mut key = String::new();
    for part in chord.split('+').map(|p| p.trim().to_lowercase()) {
        match part.as_str() {
            "ctrl" | "control" => mods[0] = true,
            "alt" | "option" => mods[1] = true,
            "shift" => mods[2] = true,
            "super" | "cmd" | "command" | "meta" => mods[3] = true,
            _ => key = part.to_uppercase(),
        }
    }
    (mods, key)
}

fn reserved_by(chord: &str) -> Option<&'static str> {
    let chord = parse(chord);
    RESERVED
        .iter()
        .find(|(c, _)| parse(c) == chord)
        .map(|(_, owner)| *owner)
}

/// The card-key chords (modifiers + 1–3 pin, modifiers + ⇧ + 1–3 dismiss) while card keys are on.
fn card_chords(settings: &Settings) -> Vec<Chord> {
    let keys = &settings.copilot.card_keys;
    if !keys.enabled {
        return vec![];
    }
    let m = keys.modifiers;
    let pin = [m.control, m.option, false, m.command];
    let dismiss = [m.control, m.option, true, m.command];
    ["1", "2", "3"]
        .iter()
        .flat_map(|k| [(pin, k.to_string()), (dismiss, k.to_string())])
        .collect()
}

fn conflict(owner: Option<String>) -> CoreError {
    CoreError::new(ErrorCode::HotkeyConflict, "shortcut in use")
        .with_detail(ErrorDetail::HotkeyOwner { owner })
}

fn action_name(action: HotkeyAction) -> String {
    serde_json::to_value(action)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

/// The stored bindings: action → chord or `null`.
fn stored(list: &HotkeyList) -> Value {
    let map: Map<String, Value> = list
        .bindings
        .iter()
        .map(|b| {
            (
                action_name(b.action),
                b.shortcut.clone().map_or(Value::Null, Value::String),
            )
        })
        .collect();
    Value::Object(map)
}

/// The default bindings, not yet registered.
fn default_list(version: StateVersion) -> HotkeyList {
    let bindings = DEFAULT_HOTKEYS
        .iter()
        .map(|(action, chord)| HotkeyBinding {
            action: *action,
            shortcut: Some(chord.to_string()),
            default_shortcut: Some(chord.to_string()),
            status: HotkeyStatus::NotSet,
        })
        .collect();
    HotkeyList { version, bindings }
}

// @cpt-algo:cpt-noter-algo-core-settings-hotkey-check:p1
fn check(
    list: &HotkeyList,
    settings: &Settings,
    action: HotkeyAction,
    chord: &str,
) -> Result<(), CoreError> {
    let parsed = parse(chord);
    // @cpt-begin:cpt-noter-algo-core-settings-hotkey-check:p1:inst-no-modifier
    if !parsed.0.iter().any(|m| *m) {
        return Err(invalid("shortcut", ValidationRule::NoModifier));
    }
    // @cpt-end:cpt-noter-algo-core-settings-hotkey-check:p1:inst-no-modifier
    // @cpt-begin:cpt-noter-algo-core-settings-hotkey-check:p1:inst-reserved
    if let Some(owner) = reserved_by(chord) {
        return Err(
            CoreError::new(ErrorCode::HotkeyReserved, "reserved shortcut").with_detail(
                ErrorDetail::HotkeyOwner {
                    owner: Some(owner.into()),
                },
            ),
        );
    }
    // @cpt-end:cpt-noter-algo-core-settings-hotkey-check:p1:inst-reserved
    // @cpt-begin:cpt-noter-algo-core-settings-hotkey-check:p1:inst-internal-conflict
    let other = list
        .bindings
        .iter()
        .find(|b| b.action != action && b.shortcut.as_deref().map(parse) == Some(parsed.clone()));
    if let Some(other) = other {
        return Err(conflict(Some(action_name(other.action))));
    }
    if card_chords(settings).contains(&parsed) {
        return Err(conflict(Some("card keys".into())));
    }
    // @cpt-end:cpt-noter-algo-core-settings-hotkey-check:p1:inst-internal-conflict
    // @cpt-begin:cpt-noter-algo-core-settings-hotkey-check:p1:inst-return-ok
    Ok(())
    // @cpt-end:cpt-noter-algo-core-settings-hotkey-check:p1:inst-return-ok
}

impl Core {
    /// The stored bindings over the defaults, registered; at core start.
    pub(crate) fn start_hotkeys(&self) -> Result<(), CoreError> {
        let stored: Option<String> = self.store().read(|c| {
            use noter_db::rusqlite::OptionalExtension;
            c.query_row(
                "SELECT value FROM settings WHERE key = 'hotkeys'",
                [],
                |r| r.get(0),
            )
            .optional()
        })?;
        let mut list = lock(&self.hotkeys);
        if let Some(Value::Object(map)) = stored.and_then(|s| serde_json::from_str(&s).ok()) {
            for b in &mut list.bindings {
                if let Some(chord) = map.get(&action_name(b.action)) {
                    b.shortcut = chord.as_str().map(String::from);
                }
            }
        }
        self.register_all(&mut list);
        Ok(())
    }

    /// Registers every bound app hotkey and records the ones macOS refused in the degraded set.
    // @cpt-algo:cpt-noter-algo-core-settings-register-hotkeys:p1
    // @cpt-state:cpt-noter-state-core-settings-hotkey:p1
    fn register_all(&self, list: &mut HotkeyList) {
        let mut refused = vec![];
        // @cpt-begin:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-for-bindings
        for b in &mut list.bindings {
            let Some(chord) = b.shortcut.clone() else {
                b.status = HotkeyStatus::NotSet;
                continue;
            };
            // @cpt-begin:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-skip-card-keys
            if b.action == HotkeyAction::UndoCardAction {
                b.status = HotkeyStatus::RegisteredDuringCapture;
                continue;
            }
            // @cpt-end:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-skip-card-keys
            // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-reserved
            if reserved_by(&chord).is_some() {
                b.status = HotkeyStatus::ReservedBySystem;
                continue;
            }
            // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-reserved
            // @cpt-begin:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-try-register
            let registered = self.deps.shortcuts.register(&chord);
            // @cpt-end:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-try-register
            b.status = match registered {
                Ok(()) => HotkeyStatus::Registered,
                Err(taken) => {
                    // @cpt-begin:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-catch-register
                    refused.push(b.action);
                    // @cpt-end:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-catch-register
                    // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-conflict
                    HotkeyStatus::Conflict { owner: taken.owner }
                    // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-conflict
                }
            };
        }
        // @cpt-end:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-for-bindings
        // @cpt-begin:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-return-registered
        // The list is updated in place; the refused actions are the degraded set's.
        self.set_hotkey_degraded(refused);
        // @cpt-end:cpt-noter-algo-core-settings-register-hotkeys:p1:inst-return-registered
    }

    /// `HotkeyNotRegistered` in the degraded set is exactly the refused actions.
    fn set_hotkey_degraded(&self, refused: Vec<HotkeyAction>) {
        let mut app = self.app();
        let mut states: Vec<DegradedState> = app
            .degraded
            .states
            .iter()
            .filter(|s| !matches!(s, DegradedState::HotkeyNotRegistered { .. }))
            .cloned()
            .collect();
        states.extend(
            refused
                .into_iter()
                .map(|action| DegradedState::HotkeyNotRegistered { action }),
        );
        if states != app.degraded.states {
            app.degraded.states = states;
            self.publish(event_names::DEGRADED_CHANGED, &mut app.degraded);
        }
    }

    // @cpt-flow:cpt-noter-flow-core-settings-hotkey-set:p1
    pub(crate) fn set_hotkey(
        &self,
        ctx: &CommandCtx,
        args: HotkeySetArgs,
    ) -> Result<HotkeyList, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-hotkey-call
        let mut list = lock(&self.hotkeys);
        let at = list
            .bindings
            .iter()
            .position(|b| b.action == args.action)
            .ok_or_else(|| internal("unknown action"))?;
        let old = list.bindings[at].clone();
        let held = |b: &HotkeyBinding| b.status == HotkeyStatus::Registered;
        // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-hotkey-call
        let status = match &args.shortcut {
            // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-if-clear
            None => {
                // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-clear
                if let (true, Some(chord)) = (held(&old), &old.shortcut) {
                    self.deps.shortcuts.unregister(chord);
                }
                // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-clear
                HotkeyStatus::NotSet
                // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-clear
                // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-clear
            }
            // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-if-clear
            Some(chord) => {
                // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-run-check
                check(&list, &lock(&self.settings), args.action, chord)?;
                // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-run-check
                let unchanged =
                    held(&old) && old.shortcut.as_deref().map(parse) == Some(parse(chord));
                if args.action == HotkeyAction::UndoCardAction {
                    // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-card-keys
                    HotkeyStatus::RegisteredDuringCapture
                    // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-card-keys
                } else if unchanged {
                    HotkeyStatus::Registered
                } else {
                    // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-register-new
                    self.deps
                        .shortcuts
                        .register(chord)
                        .map_err(|taken| conflict(taken.owner))?;
                    // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-register-new
                    // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-unregister-old
                    if let (true, Some(previous)) = (held(&old), &old.shortcut) {
                        self.deps.shortcuts.unregister(previous);
                    }
                    // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-unregister-old
                    registered_from(&old.status)
                }
            }
        };
        // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-store-binding
        let before = stored(&list);
        list.bindings[at].shortcut = args.shortcut.clone();
        list.bindings[at].status = status;
        let after = stored(&list);
        let meta = self.change_meta(ctx, "Changed a hotkey".into(), "hotkey_set");
        let written = self.store().write_with(meta, move |tx| {
            Ok(((), vec![put(tx, "hotkeys", &before, &after, None)?]))
        });
        if let Err(e) = written {
            list.bindings[at] = old;
            return Err(e);
        }
        // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-store-binding
        let refused = refused_actions(&list);
        self.set_hotkey_degraded(refused);
        self.hotkeys_written(&mut list)
    }

    // @cpt-flow:cpt-noter-flow-core-settings-hotkeys-reset:p2
    pub(crate) fn reset_hotkeys(&self, ctx: &CommandCtx) -> Result<HotkeyList, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-reset-call
        let mut list = lock(&self.hotkeys);
        let mut settings = lock(&self.settings);
        // @cpt-end:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-reset-call
        // @cpt-begin:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-unregister-all
        for b in list
            .bindings
            .iter()
            .filter(|b| b.status == HotkeyStatus::Registered)
        {
            if let Some(chord) = &b.shortcut {
                self.deps.shortcuts.unregister(chord);
            }
        }
        // @cpt-end:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-unregister-all
        // @cpt-begin:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-write-defaults
        let defaults = default_list(list.version);
        let (hotkeys_before, hotkeys_after) = (stored(&list), stored(&defaults));
        let mut copilot = settings.copilot.clone();
        copilot.card_keys = default_card_keys();
        copilot.dismiss_with_keys = false;
        let section = SettingsSection::Copilot(copilot);
        let copilot_before = section_of(&settings, "copilot")?;
        let copilot_after = serde_json::to_value(&section).map_err(internal)?["value"].clone();
        let meta = self.change_meta(ctx, "Restored the default hotkeys".into(), "hotkeys_reset");
        let rev = self.store().write_with(meta, move |tx| {
            let next = current_rev(tx)? + 1;
            let hotkeys = put(tx, "hotkeys", &hotkeys_before, &hotkeys_after, None)?;
            let card_keys = put(tx, "copilot", &copilot_before, &copilot_after, Some(next))?;
            Ok((Rev(next), vec![hotkeys, card_keys]))
        })?;
        self.settings_written(&mut settings, section, rev.value);
        list.bindings = defaults.bindings;
        // @cpt-end:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-write-defaults
        // @cpt-begin:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-register-defaults
        drop(settings);
        self.register_all(&mut list);
        // @cpt-end:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-register-defaults
        // @cpt-begin:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-return-reset
        self.hotkeys_written(&mut list)
        // @cpt-end:cpt-noter-flow-core-settings-hotkeys-reset:p2:inst-return-reset
    }

    fn hotkeys_written(
        &self,
        list: &mut MutexGuard<'_, HotkeyList>,
    ) -> Result<HotkeyList, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-emit-hotkeys
        let stamped = self.publish(event_names::HOTKEYS_CHANGED, &mut **list);
        // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-emit-hotkeys
        // @cpt-begin:cpt-noter-flow-core-settings-hotkey-set:p1:inst-return-hotkeys
        Ok(stamped)
        // @cpt-end:cpt-noter-flow-core-settings-hotkey-set:p1:inst-return-hotkeys
    }
}

impl Core {
    /// What a pressed hotkey asks of the core: its action's command and arguments, called as
    /// `Caller::Native { surface: hotkey }`. Keys that act on the recorded call answer
    /// `not_recording` while nothing is recorded.
    // @cpt-dod:cpt-noter-dod-core-settings-hotkeys:p1
    pub fn hotkey_command(
        &self,
        chord: &str,
    ) -> Result<(CommandCtx, &'static str, Value), CoreError> {
        let pressed = parse(chord);
        let action = lock(&self.hotkeys)
            .bindings
            .iter()
            .find(|b| b.shortcut.as_deref().map(parse) == Some(pressed.clone()))
            .map(|b| b.action)
            .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no hotkey for this chord"))?;
        let app = self.app();
        let recording = matches!(
            app.capture.phase,
            CapturePhase::Starting | CapturePhase::Recording | CapturePhase::Paused
        );
        let live = app.capture.call_id.clone().filter(|_| recording);
        let paused = app.capture.phase == CapturePhase::Paused;
        let hidden = app.presenting.hidden;
        drop(app);
        let call = || {
            live.clone()
                .ok_or_else(|| CoreError::new(ErrorCode::NotRecording, action_name(action)))
        };
        let (command, args) = match action {
            HotkeyAction::StartStop => match &live {
                Some(call_id) => ("capture_stop", json!({ "call_id": call_id })),
                None => (
                    "capture_start",
                    json!({ "source": "hotkey", "sensitive": false }),
                ),
            },
            HotkeyAction::Pause => (
                "capture_set_paused",
                json!({ "call_id": call()?, "paused": !paused }),
            ),
            HotkeyAction::MarkMoment => ("capture_mark_moment", json!({ "call_id": call()? })),
            HotkeyAction::CatchMeUp => ("copilot_catch_up", json!({ "call_id": call()? })),
            // shortcut: the key only mutes; the contract has no unmute command yet (copilot, M4).
            HotkeyAction::MuteCopilot => (
                "copilot_mute",
                json!({ "call_id": call()?, "scope": { "type": "this_call" } }),
            ),
            HotkeyAction::UndoCardAction => ("card_undo_last", json!({ "call_id": call()? })),
            HotkeyAction::OpenCallScreen => ("window_show_call", json!({})),
            HotkeyAction::HideForPresenting => (
                "app_set_hidden_for_presenting",
                json!({ "hidden": !hidden }),
            ),
            HotkeyAction::AskAboutCall => {
                return Err(CoreError::new(
                    ErrorCode::NotImplemented,
                    "ask_about_call: the Ask panel comes with M3",
                ));
            }
        };
        Ok((
            CommandCtx {
                caller: Caller::Native {
                    surface: NativeSurface::Hotkey,
                },
            },
            command,
            args,
        ))
    }

    /// A pressed hotkey (the host's global-shortcut handler): its command through the core.
    pub async fn hotkey_pressed(&self, chord: &str) -> Result<Value, CoreError> {
        let (ctx, command, args) = self.hotkey_command(chord)?;
        dispatch_json(self, &ctx, command, args, None).await
    }
}

/// A chord macOS accepted: from not_set, from a conflict, or a new chord over a registered one.
fn registered_from(old: &HotkeyStatus) -> HotkeyStatus {
    match old {
        // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-register
        HotkeyStatus::NotSet => HotkeyStatus::Registered,
        // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-register
        // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-resolve
        HotkeyStatus::Conflict { .. } | HotkeyStatus::ReservedBySystem => HotkeyStatus::Registered,
        // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-resolve
        // @cpt-begin:cpt-noter-state-core-settings-hotkey:p1:inst-st-rebind
        _ => HotkeyStatus::Registered,
        // @cpt-end:cpt-noter-state-core-settings-hotkey:p1:inst-st-rebind
    }
}

fn refused_actions(list: &HotkeyList) -> Vec<HotkeyAction> {
    list.bindings
        .iter()
        .filter(|b| matches!(b.status, HotkeyStatus::Conflict { .. }))
        .map(|b| b.action)
        .collect()
}

impl crate::app::WholeState for HotkeyList {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

pub(crate) fn fresh_list() -> HotkeyList {
    default_list(StateVersion(1))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use crate::{CoreDeps, EventEmitter, SystemClock};

    struct Quiet;

    impl EventEmitter for Quiet {
        fn emit(&self, _: &'static str, _: Value) {}
    }

    #[test]
    fn the_call_keys_act_on_the_recorded_call() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(
            dir.path(),
            CoreDeps::new(Arc::new(SystemClock), Arc::new(Quiet)),
        )
        .unwrap();
        {
            let mut app = core.app();
            app.capture.phase = CapturePhase::Paused;
            app.capture.call_id = Some(CallId::new("call_live"));
            app.presenting.hidden = true;
        }
        let command = |chord: &str| core.hotkey_command(chord).map(|(_, c, a)| (c, a)).unwrap();
        let call = json!("call_live");
        assert_eq!(
            command("Ctrl+Alt+Super+R"),
            ("capture_stop", json!({ "call_id": call }))
        );
        assert_eq!(
            command("Ctrl+Alt+Super+P"),
            (
                "capture_set_paused",
                json!({ "call_id": call, "paused": false })
            )
        );
        assert_eq!(
            command("Ctrl+Alt+Super+M"),
            ("capture_mark_moment", json!({ "call_id": call }))
        );
        assert_eq!(
            command("Ctrl+Alt+Super+C"),
            ("copilot_catch_up", json!({ "call_id": call }))
        );
        let mute = json!({ "call_id": call, "scope": { "type": "this_call" } });
        assert_eq!(command("Ctrl+Alt+Super+K"), ("copilot_mute", mute));
        assert_eq!(
            command("Ctrl+Alt+Super+Z"),
            ("card_undo_last", json!({ "call_id": call }))
        );
        assert_eq!(
            command("Ctrl+Alt+Super+0"),
            ("app_set_hidden_for_presenting", json!({ "hidden": false }))
        );
    }
}
