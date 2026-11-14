// Responsibilities from the core native surfaces feature.
use super::*;
use noter_protocol::ipc::event_names;
use noter_protocol::model::{CaptureState, NavTarget};
use noter_protocol::CallId;
use serde_json::{json, Value};
use tauri::menu::{MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};


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
    );
    let title = c.title.clone().unwrap_or_else(|| "this call".into());
    Some((c.call_id.clone().filter(|_| open)?, title))
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
        QUIT_ALERT_PENDING.store(false, Ordering::Release);
        app.exit(0);
        return;
    };
    let app = app.clone();
    // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-user-quit
    tauri::async_runtime::spawn(async move {
        let ctx = native(NativeSurface::Menu);
        let capture = core.app_snapshot(&ctx, NoArgs {}).await.map(|s| s.capture);
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-if-idle
        let Some((call_id, title)) = capture.ok().as_ref().and_then(running_call) else {
            QUIT_ALERT_PENDING.store(false, Ordering::Release);
            // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
            app.exit(0);
            return;
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit
        };
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
                let _ = dispatch_and_record(core.as_ref(), &ctx, "capture_stop", args).await;
                QUIT_ALERT_PENDING.store(false, Ordering::Release);
                app.exit(0);
            });
            // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-stop-quit
        });
        // @cpt-begin:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
        // Cancel keeps the recording; Stop and Quit saves it before Noter quits.
        // @cpt-end:cpt-noter-flow-ui-dialogs-host-quit:p1:inst-return-quit-done
    });
}

/// The app menu's id for **Quit Noter** ⌘Q.
pub const APP_QUIT: &str = "AppQuit";
pub const APP_SETTINGS: &str = "AppSettings";
pub const APP_SETUP: &str = "AppSetup";
pub const APP_MENU_ACTION: &str = "shell:menu-action";
static QUIT_ALERT_PENDING: AtomicBool = AtomicBool::new(false);

/// The default app menu with Noter's own **Quit Noter** ⌘Q in place of the predefined one, which
/// ends the app with no event to stop it (the quit alert could not ask).
// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let model: Value = serde_json::from_str(include_str!("../../../src/features/shell/menu-model.json"))
        .expect("the shared shell menu model is valid JSON");
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
        for item in first.items()?.into_iter().rev() {
            if matches!(&item, MenuItemKind::Predefined(p) if matches!(p.text().unwrap_or_default().as_str(), "Quit Noter" | "Hide Others" | "Hide Noter"))
            {
                first.remove(&item)?;
            }
        }
        first.append(&PredefinedMenuItem::separator(app)?)?;
        append_model_item(app, &first, &model, "menu.settings", APP_SETTINGS)?;
        append_model_item(app, &first, &model, "menu.run_setup_again", APP_SETUP)?;
        first.append(&PredefinedMenuItem::separator(app)?)?;
        first.append(&PredefinedMenuItem::hide(app, None)?)?;
        first.append(&PredefinedMenuItem::separator(app)?)?;
        let item = MenuItem::with_id(app, APP_QUIT, "Quit Noter", true, Some("CmdOrCtrl+Q"))?;
        first.append(&item)?;
    }
    let file = submenu(&menu, "File");
    clear_submenu(&file)?;
    append_model_items(app, &file, &model, "menu.title.file", 0)?;
    let edit = submenu(&menu, "Edit");
    for item in edit.items()? {
        if matches!(&item, MenuItemKind::Predefined(p) if p.text().unwrap_or_default() == "Select All") {
            edit.remove(&item)?;
        }
    }
    append_model_items(app, &edit, &model, "menu.title.edit", 6)?;
    edit.append(&PredefinedMenuItem::separator(app)?)?;
    edit.append(&MenuItem::with_id(app, APP_FIX_TERM, "Fix Term…", false, None::<&str>)?)?;
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
        .and_then(|groups| groups.iter().find(|g| g["title"] == title_key)?.get("items")?.as_array())
        .expect("the shared menu model has this group");
    for entry in item_keys.iter().skip(skip) {
        if entry.is_null() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        } else {
            let key = entry["key"].as_str().expect("menu entries have a key");
            append_model_entry(app, menu, key, key, entry["accelerator"].as_str())?;
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
    append_model_entry(app, menu, key, id, accelerator)
}

fn append_model_entry<R: Runtime>(
    app: &AppHandle<R>,
    menu: &Submenu<R>,
    key: &str,
    id: &str,
    accelerator: Option<&str>,
) -> tauri::Result<()> {
    menu.append(&MenuItem::with_id(app, id, catalogue(key), true, accelerator)?)?;
    Ok(())
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

    #[test]
    fn native_menu_labels_come_from_the_shared_model() {
        let model: Value =
            serde_json::from_str(include_str!("../../../src/features/shell/menu-model.json")).unwrap();
        let groups = model.as_array().unwrap();
        assert_eq!(groups.len(), 7);
        for group in groups {
            assert!(!catalogue(group["title"].as_str().unwrap()).is_empty());
            for item in group["items"].as_array().unwrap().iter().filter(|item| !item.is_null()) {
                let key = item["key"].as_str().unwrap();
                assert!(!catalogue(key).is_empty(), "missing menu label: {key}");
            }
        }
    }
}
