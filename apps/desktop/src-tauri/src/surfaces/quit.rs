// Responsibilities from the core native surfaces feature.
use super::*;
use noter_core::{TrayAction, TrayModel};
use noter_protocol::ipc::event_names;
use noter_protocol::model::{CaptureState, NavTarget};
use noter_protocol::CallId;
use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};

/// The UI string catalogue the quit alert's words come from (`apps/desktop/src/i18n/en.ts`).
const CATALOGUE: &str = include_str!("../../../src/i18n/en.ts");

/// The catalogue's string for `key`: the first quoted text after `"key":`.
fn catalogue(key: &str) -> String {
    let after = CATALOGUE
        .split(&format!("\"{key}\":"))
        .nth(1)
        .unwrap_or_default();
    after.split('"').nth(1).unwrap_or_default().to_string()
}

/// The quit-while-recording alert: title, message, the default **Cancel** and **Stop and Quit**.
// @cpt-dod:cpt-noter-dod-ui-dialogs-host-delete:p2
pub fn quit_alert(call_title: &str) -> [String; 4] {
    [
        catalogue("dialogs.quit.title").replace("{title}", call_title),
        catalogue("dialogs.quit.message"),
        catalogue("dialogs.cancel"),
        catalogue("dialogs.quit.confirm"),
    ]
}

/// The call a quit would end, with its title: a capture is running or waits for **Try Again**.
pub fn running_call(c: &CaptureState) -> Option<(CallId, String)> {
    let open = matches!(
        c.phase,
        CapturePhase::Starting
            | CapturePhase::Recording
            | CapturePhase::Paused
            | CapturePhase::Failed
            | CapturePhase::Stopping
    );
    let title = c.title.clone().unwrap_or_else(|| "this call".into());
    Some((c.call_id.clone().filter(|_| open)?, title))
}

fn quit_if_idle(
    capture: Result<CaptureState, CoreError>,
    exit: impl FnOnce(),
) -> Result<Option<(CallId, String)>, CoreError> {
    let call = running_call(&capture?);
    if call.is_none() {
        exit();
    }
    Ok(call)
}

fn quit_after_stop(result: Result<Value, CoreError>, exit: impl FnOnce()) -> Result<(), CoreError> {
    let capture = result?;
    let stopped = capture["phase"].as_str() == Some("stopped");
    let discarded = capture["phase"].as_str() == Some("idle")
        && matches!(capture.get("call_id"), Some(Value::Null));
    if !stopped && !discarded {
        return Err(CoreError::new(
            noter_protocol::ErrorCode::NotReady,
            "the recording is still stopping",
        ));
    }
    exit();
    Ok(())
}

/// **Quit Noter** from the menu bar or ⌘Q: Noter quits at once when nothing is recording;
/// otherwise the alert asks, with **Cancel** as the default, and **Stop and Quit** saves first.
// @cpt-flow:cpt-noter-flow-ui-dialogs-host-quit:p1
pub fn quit<R: Runtime>(app: &AppHandle<R>) {
    // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-user-quit
    if QUIT_ALERT_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    let Some(core) = core_of(app) else {
        quit_error(
            app,
            &CoreError::new(
                noter_protocol::ErrorCode::NotReady,
                "the core is unavailable",
            ),
        );
        return;
    };
    let app = app.clone();
    // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-user-quit
    tauri::async_runtime::spawn(async move {
        let ctx = native(NativeSurface::Menu);
        let capture = core.app_snapshot(&ctx, NoArgs {}).await.map(|s| s.capture);
        #[cfg(all(debug_assertions, feature = "test-hooks"))]
        let capture = crate::test_hooks::quit_error_once("snapshot").map_or(capture, Err);
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-idle
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
        let (call_id, title) = match quit_if_idle(capture, || app.exit(0)) {
            Ok(Some(call)) => call,
            Ok(None) => {
                QUIT_ALERT_PENDING.store(false, Ordering::Release);
                return;
            }
            Err(error) => {
                quit_error(&app, &error);
                return;
            }
        };
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-idle
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert
        // NSAlert makes the first button the default: Cancel goes first, so Return keeps recording.
        let [title, message, cancel, confirm] = quit_alert(&title);
        let stop = MessageDialogResult::Custom(confirm.clone());
        let dialog = app
            .dialog()
            .message(message)
            .title(title)
            .buttons(MessageDialogButtons::OkCancelCustom(cancel, confirm));
        // Without a parent rfd posts a system alert from another process instead of Noter's NSAlert:
        // it goes on the main window when it shows, else on the call window.
        let parent = [WindowLabel::Main, WindowLabel::CallScreen]
            .into_iter()
            .filter_map(|label| app.get_webview_window(label.as_str()))
            .find(|w| w.is_visible().unwrap_or(false));
        let dialog = match &parent {
            Some(window) => dialog.parent(window),
            None => dialog,
        };
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-quit-alert
        dialog.show_with_result(move |answer| {
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-stop-quit
            if answer != stop {
                QUIT_ALERT_PENDING.store(false, Ordering::Release);
                return;
            }
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-stop-quit
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-stop-quit
            tauri::async_runtime::spawn(async move {
                let args = json!({ "call_id": call_id });
                #[cfg(all(debug_assertions, feature = "test-hooks"))]
                let fault = crate::test_hooks::quit_error_once("stop");
                #[cfg(not(all(debug_assertions, feature = "test-hooks")))]
                let fault: Option<CoreError> = None;
                let result = match fault {
                    Some(error) => Err(error),
                    None => dispatch_and_record(core.as_ref(), &ctx, "capture_stop", args).await,
                };
                match quit_after_stop(result, || app.exit(0)) {
                    Ok(()) => QUIT_ALERT_PENDING.store(false, Ordering::Release),
                    Err(error) => quit_error(&app, &error),
                }
            });
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-stop-quit
        });
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
        // Cancel keeps the recording; Stop and Quit saves it before Noter quits.
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
    });
}

/// Keep the pending guard through the error alert too: another Quit cannot stack a second decision.
fn quit_error<R: Runtime>(app: &AppHandle<R>, error: &CoreError) {
    eprintln!("noter: could not quit safely: {error}");
    let dialog = app
        .dialog()
        .message(catalogue("dialogs.quit.failed_message"))
        .title(catalogue("dialogs.quit.failed_title"))
        .kind(tauri_plugin_dialog::MessageDialogKind::Error);
    let parent = [WindowLabel::Main, WindowLabel::CallScreen]
        .into_iter()
        .filter_map(|label| app.get_webview_window(label.as_str()))
        .find(|window| window.is_visible().unwrap_or(false));
    let dialog = match &parent {
        Some(window) => dialog.parent(window),
        None => dialog,
    };
    dialog.show_with_result(|_| QUIT_ALERT_PENDING.store(false, Ordering::Release));
}

/// The app menu's id for **Quit Noter** ⌘Q.
pub const APP_QUIT: &str = "AppQuit";
pub const APP_SETTINGS: &str = "AppSettings";
pub const APP_SETUP: &str = "AppSetup";
pub const APP_MENU_ACTION: &str = "shell:menu-action";
pub const APP_MENU_CONTEXT: &str = "shell:menu-context";
pub const APP_SELECT_ALL: &str = "menu.select_all";
static QUIT_ALERT_PENDING: AtomicBool = AtomicBool::new(false);

/// The default app menu with Noter's own **Quit Noter** ⌘Q in place of the predefined one, which
/// ends the app with no event to stop it (the quit alert could not ask).
// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let model: Value =
        serde_json::from_str(include_str!("../../../src/features/shell/menu-model.json"))
            .expect("the shared shell menu model is valid JSON");
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
        for item in first.items()?.into_iter().rev() {
            if matches!(&item, MenuItemKind::Predefined(p) if matches!(p.text().unwrap_or_default().as_str(), "Quit Noter" | "Hide Others" | "Hide Noter" | "Show All"))
            {
                first.remove(&item)?;
            }
        }
        first.append(&PredefinedMenuItem::separator(app)?)?;
        append_model_item(app, &first, &model, "menu.settings", APP_SETTINGS)?;
        append_model_item(app, &first, &model, "menu.run_setup_again", APP_SETUP)?;
        first.append(&PredefinedMenuItem::separator(app)?)?;
        first.append(&PredefinedMenuItem::hide(app, None)?)?;
        first.append(&PredefinedMenuItem::hide_others(app, None)?)?;
        first.append(&PredefinedMenuItem::show_all(app, None)?)?;
        first.append(&PredefinedMenuItem::separator(app)?)?;
        let item = MenuItem::with_id(app, APP_QUIT, "Quit Noter", true, Some("CmdOrCtrl+Q"))?;
        first.append(&item)?;
    }
    let file = submenu(&menu, "File");
    clear_submenu(&file)?;
    append_model_items(app, &file, &model, "menu.title.file", 0)?;
    let edit = submenu(&menu, "Edit");
    append_model_items(app, &edit, &model, "menu.title.edit", 6)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&MenuItem::with_id(
        app,
        APP_FIX_TERM,
        "Fix Term…",
        false,
        None::<&str>,
    )?)?;
    let view = submenu(&menu, "View");
    clear_submenu(&view)?;
    append_model_items(app, &view, &model, "menu.title.view", 0)?;
    let call = Submenu::with_id(app, "Call", catalogue("menu.title.call"), true)?;
    append_model_items(app, &call, &model, "menu.title.call", 0)?;
    menu.insert(&call, 4)?;
    let help = submenu(&menu, "Help");
    append_model_items(app, &help, &model, "menu.title.help", 0)?;
    Ok(menu)
}

fn submenu<R: Runtime>(menu: &Menu<R>, title: &str) -> Submenu<R> {
    menu.items()
        .expect("read the default menu")
        .into_iter()
        .find_map(|item| match item {
            MenuItemKind::Submenu(sub) if sub.text().ok().as_deref() == Some(title) => Some(sub),
            _ => None,
        })
        .expect("the default menu contains this standard submenu")
}

fn clear_submenu<R: Runtime>(menu: &Submenu<R>) -> tauri::Result<()> {
    for item in menu.items()? {
        menu.remove(&item)?;
    }
    Ok(())
}

fn append_model_items<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Submenu<R>,
    model: &Value,
    title_key: &str,
    skip: usize,
) -> tauri::Result<()> {
    let item_keys = model
        .as_array()
        .and_then(|groups| {
            groups
                .iter()
                .find(|g| g["title"] == title_key)?
                .get("items")?
                .as_array()
        })
        .expect("the shared menu model has this group");
    for entry in item_keys.iter().skip(skip) {
        if entry.is_null() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        } else {
            let key = entry["key"].as_str().expect("menu entries have a key");
            append_model_entry(
                app,
                menu,
                key,
                key,
                entry["accelerator"].as_str(),
                initially_enabled(key),
            )?;
        }
    }
    Ok(())
}

fn append_model_item<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Submenu<R>,
    model: &Value,
    key: &str,
    id: &str,
) -> tauri::Result<()> {
    let accelerator = model
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["items"].as_array().into_iter().flatten())
        .find(|entry| entry["key"] == key)
        .and_then(|entry| entry["accelerator"].as_str());
    append_model_entry(app, menu, key, id, accelerator, true)
}

fn append_model_entry<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Submenu<R>,
    key: &str,
    id: &str,
    accelerator: Option<&str>,
    enabled: bool,
) -> tauri::Result<()> {
    if key == "menu.use_floating_panel" {
        menu.append(&CheckMenuItem::with_id(
            app,
            id,
            catalogue(key),
            enabled,
            false,
            accelerator,
        )?)?;
    } else {
        menu.append(&MenuItem::with_id(
            app,
            id,
            catalogue(key),
            enabled,
            accelerator,
        )?)?;
    }
    Ok(())
}

fn initially_enabled(key: &str) -> bool {
    matches!(
        key,
        "menu.find"
            | "menu.hide_sidebar"
            | "menu.show_inspector"
            | "menu.back"
            | "menu.forward"
            | "menu.actual_size"
            | "menu.zoom_in"
            | "menu.zoom_out"
            | "section.today"
            | "section.ask"
            | "section.library"
            | "section.people"
            | "section.topics"
            | "section.activity"
            | "section.agents"
            | "section.performance"
    )
}

/// Enables contextual share commands only while a ready call page is the key window.
pub fn update_context_menu<R: Runtime>(app: &AppHandle<R>, payload: &str) {
    let Ok(state) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    let focused = state["focused"].as_bool().unwrap_or(false);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(menu) = handle.menu() {
            if let Some(calls) = state["selectAllCalls"].as_bool() {
                // Calls publishes this field independently, already scoped to row focus and modal state.
                if let Err(error) = select_all_context(&handle, &menu, calls) {
                    eprintln!("noter: Select All menu context: {error}");
                }
            }
            for (field, id) in [
                ("exportEnabled", "menu.export"),
                ("copySlackEnabled", "menu.copy_for_slack"),
                ("copyJiraEnabled", "menu.copy_for_jira"),
                ("copyMarkdownEnabled", "menu.copy_as_markdown"),
                ("deleteEnabled", "menu.delete"),
                ("acceptItemEnabled", "menu.accept_item"),
                ("acceptAllSuggestionsEnabled", "menu.accept_all_suggestions"),
                ("rejectItemEnabled", "menu.reject_item"),
            ] {
                if let Some(enabled) = state[field].as_bool() {
                    set_enabled_by_id(&menu, id, focused && enabled);
                }
            }
            if let Some(visible) = state["sidebarVisible"].as_bool() {
                set_text_enabled_by_id(
                    &handle,
                    "menu.hide_sidebar",
                    if visible {
                        "Hide Sidebar"
                    } else {
                        "Show Sidebar"
                    },
                    true,
                );
            }
        }
    });
}

/// AppKit owns text selection. Only a focused Calls table substitutes its existing row-selection command.
fn select_all_context<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Menu<R>,
    calls: bool,
) -> tauri::Result<()> {
    let edit = submenu(menu, "Edit");
    for (index, item) in edit.items()?.into_iter().enumerate() {
        let custom = item.id().as_ref() == APP_SELECT_ALL;
        let native = matches!(&item, MenuItemKind::Predefined(p) if p.text().unwrap_or_default() == "Select All");
        if !custom && !native {
            continue;
        }
        if custom != calls {
            edit.remove(&item)?;
            if calls {
                edit.insert(
                    &MenuItem::with_id(
                        app,
                        APP_SELECT_ALL,
                        "Select All",
                        true,
                        Some("CmdOrCtrl+A"),
                    )?,
                    index,
                )?;
            } else {
                edit.insert(&PredefinedMenuItem::select_all(app, None)?, index)?;
            }
        }
        break;
    }
    Ok(())
}

/// Mirror the core's recording and presenting state in the app-owned Call menu.
pub fn update_app_menu_from_tray<R: Runtime>(app: &AppHandle<R>, model: &TrayModel) {
    for (id, label, enabled, checked) in app_menu_state(model) {
        set_text_enabled_by_id(app, id, &label, enabled);
        if let Some(checked) = checked {
            set_checked_by_id(app, id, checked);
        }
    }
}

/// Each Call menu item's label, enabled state and checkmark from the tray model. An item the
/// model leaves out (Pause and Mark Moment with no recording) is dimmed under its catalogue
/// label, never left as it last was (issue 1041).
fn app_menu_state(model: &TrayModel) -> Vec<(&'static str, String, bool, Option<bool>)> {
    let either = |on: TrayAction, off: TrayAction| {
        model
            .item(on)
            .filter(|item| item.enabled)
            .or_else(|| model.item(off))
    };
    [
        (
            "menu.start_recording",
            either(TrayAction::StopRecording, TrayAction::StartRecording),
        ),
        ("menu.pause", either(TrayAction::Pause, TrayAction::Resume)),
        (
            "menu.hide_for_presenting",
            either(
                TrayAction::HideForPresenting,
                TrayAction::ShowAfterPresenting,
            ),
        ),
        ("menu.mark_moment", model.item(TrayAction::MarkMoment)),
        (
            "menu.open_call_screen",
            model.item(TrayAction::OpenCallScreen),
        ),
        (
            "menu.use_floating_panel",
            model.item(TrayAction::UseFloatingPanel),
        ),
    ]
    .into_iter()
    .map(|(id, item)| match item {
        Some(item) => (id, item.label.clone(), item.enabled, item.checked),
        None => (id, catalogue(id), false, None),
    })
    .collect()
}

fn set_enabled_by_id<R: Runtime>(menu: &Menu<R>, id: &str, enabled: bool) {
    let mut update = |item: &MenuItemKind<R>| match item {
        MenuItemKind::MenuItem(item) => {
            let _ = item.set_enabled(enabled);
        }
        MenuItemKind::Check(item) => {
            let _ = item.set_enabled(enabled);
        }
        _ => {}
    };
    update_items(menu.items().unwrap_or_default(), id, &mut update);
}

fn set_text_enabled_by_id<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, enabled: bool) {
    if let Some(menu) = app.menu() {
        let mut update = |item: &MenuItemKind<R>| match item {
            MenuItemKind::MenuItem(item) => {
                let _ = item.set_text(label);
                let _ = item.set_enabled(enabled);
            }
            MenuItemKind::Check(item) => {
                let _ = item.set_text(label);
                let _ = item.set_enabled(enabled);
            }
            _ => {}
        };
        update_items(menu.items().unwrap_or_default(), id, &mut update);
    }
}

fn set_checked_by_id<R: Runtime>(app: &AppHandle<R>, id: &str, checked: bool) {
    if let Some(menu) = app.menu() {
        let mut update = |item: &MenuItemKind<R>| {
            if let MenuItemKind::Check(item) = item {
                let _ = item.set_checked(checked);
            }
        };
        update_items(menu.items().unwrap_or_default(), id, &mut update);
    }
}

fn update_items<R: Runtime>(
    items: Vec<MenuItemKind<R>>,
    id: &str,
    update: &mut dyn FnMut(&MenuItemKind<R>),
) {
    for item in &items {
        if item.id().as_ref() == id {
            update(item);
        }
        if let MenuItemKind::Submenu(submenu) = item {
            update_items(submenu.items().unwrap_or_default(), id, update);
        }
    }
}

/// The Edit menu's id for **Fix Term…**.
pub const APP_FIX_TERM: &str = "AppFixTerm";

/// **Fix Term…** was chosen: the windows open the term fix on their current selection.
pub fn fix_term_chosen<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(event_names::MENU_FIX_TERM, json!({}));
}

/// The native app menu's navigation items use the same core path as in-window links.
pub fn navigate_from_menu<R: Runtime>(app: &AppHandle<R>, target: NavTarget) {
    let Some(core) = core_of(app) else { return };
    tauri::async_runtime::spawn(async move {
        let ctx = native(NativeSurface::Menu);
        let args = json!({ "target": target });
        let _ = dispatch_and_record(core.as_ref(), &ctx, "window_navigate", args).await;
    });
}

#[cfg(test)]
mod menu_tests {
    use super::*;

    fn item(action: TrayAction, label: &str, enabled: bool) -> noter_core::TrayEntry {
        noter_core::TrayEntry::Item(noter_core::TrayItem {
            action,
            label: label.into(),
            enabled,
            checked: None,
            key: None,
        })
    }

    fn state_of(entries: Vec<noter_core::TrayEntry>, id: &str) -> (String, bool) {
        let model = TrayModel {
            glyph: noter_core::TrayGlyph::Idle,
            hidden: false,
            title: None,
            label: String::new(),
            entries,
        };
        let found = app_menu_state(&model).into_iter().find(|e| e.0 == id);
        found
            .map(|(_, label, enabled, _)| (label, enabled))
            .unwrap()
    }

    // cpt-noter-seq-menu-bar-control-recording (issue 1041): no recording, nothing to pause or mark
    #[test]
    fn pause_and_mark_moment_are_dimmed_once_the_recording_ends() {
        let recording = || {
            vec![
                item(TrayAction::StopRecording, "Stop Recording", true),
                item(TrayAction::Pause, "Pause", true),
                item(TrayAction::MarkMoment, "Mark Moment", true),
            ]
        };
        assert_eq!(state_of(recording(), "menu.pause"), ("Pause".into(), true));
        assert_eq!(
            state_of(recording(), "menu.mark_moment"),
            ("Mark Moment".into(), true)
        );
        let idle = || vec![item(TrayAction::StartRecording, "Start Recording", true)];
        assert_eq!(state_of(idle(), "menu.pause"), ("Pause".into(), false));
        assert_eq!(
            state_of(idle(), "menu.mark_moment"),
            ("Mark Moment".into(), false)
        );
        assert_eq!(
            state_of(idle(), "menu.start_recording"),
            ("Start Recording".into(), true)
        );
    }

    #[test]
    fn failed_capture_snapshot_never_exits() {
        let exited = std::cell::Cell::new(false);
        let result = quit_if_idle(
            Err(CoreError::new(
                noter_protocol::ErrorCode::Internal,
                "read failed",
            )),
            || exited.set(true),
        );
        assert!(!exited.get(), "an unreadable capture is not proof of idle");
        assert!(result.is_err());
    }

    #[test]
    fn failed_stop_keeps_the_app_open_and_a_later_success_can_quit() {
        let exits = std::cell::Cell::new(0);
        let result = quit_after_stop(
            Err(CoreError::new(
                noter_protocol::ErrorCode::Internal,
                "save failed",
            )),
            || exits.set(exits.get() + 1),
        );
        assert_eq!(exits.get(), 0, "a failed save must not exit the app");
        assert!(result.is_err());
        quit_after_stop(Ok(json!({ "phase": "stopped" })), || {
            exits.set(exits.get() + 1)
        })
        .unwrap();
        assert_eq!(exits.get(), 1);
    }

    #[test]
    fn an_in_progress_stop_is_not_confirmation_that_the_recording_was_saved() {
        let exited = std::cell::Cell::new(false);
        let result = quit_after_stop(Ok(json!({ "phase": "stopping" })), || exited.set(true));
        assert!(
            !exited.get(),
            "an idempotent concurrent Stop can still be flushing files"
        );
        assert!(result.is_err());
    }

    #[test]
    fn a_completed_discard_can_quit_only_with_explicit_idle_and_no_call() {
        let exited = std::cell::Cell::new(false);
        quit_after_stop(Ok(json!({ "phase": "idle", "call_id": null })), || {
            exited.set(true)
        })
        .expect("a successful discard removed the call and returned capture to idle");
        assert!(exited.get());

        for capture in [
            json!({ "phase": "idle", "call_id": "call_still_open" }),
            json!({ "phase": "idle" }),
            json!({ "phase": "stopping", "call_id": null }),
            json!({ "call_id": null }),
        ] {
            exited.set(false);
            assert!(
                quit_after_stop(Ok(capture.clone()), || exited.set(true)).is_err(),
                "unsafe capture result: {capture}"
            );
            assert!(
                !exited.get(),
                "unconfirmed discard must not quit: {capture}"
            );
        }
    }

    #[test]
    fn native_menu_labels_come_from_the_shared_model() {
        let model: Value =
            serde_json::from_str(include_str!("../../../src/features/shell/menu-model.json"))
                .unwrap();
        let groups = model.as_array().unwrap();
        assert_eq!(groups.len(), 7);
        for group in groups {
            assert!(!catalogue(group["title"].as_str().unwrap()).is_empty());
            for item in group["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|item| !item.is_null())
            {
                let key = item["key"].as_str().unwrap();
                assert!(!catalogue(key).is_empty(), "missing menu label: {key}");
            }
        }
    }
}
