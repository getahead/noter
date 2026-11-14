// Responsibilities from the core native surfaces feature.
use super::*;
use noter_protocol::model::CaptureState;
use noter_protocol::CallId;
use tauri::menu::{MenuItem, PredefinedMenuItem};
use tauri::menu::{MenuItemKind};


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

#[cfg(test)]
mod native_menu_catalogue_tests {
    use super::catalogue;

    #[test]
    fn native_menu_labels_use_the_shared_ui_catalogue() {
        assert_eq!(catalogue("menu.quit_noter"), "Quit Noter");
        assert_eq!(catalogue("speakers.fix.menu"), "Fix Term…");
    }
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
static QUIT_ALERT_PENDING: AtomicBool = AtomicBool::new(false);

/// The default app menu with Noter's own **Quit Noter** ⌘Q in place of the predefined one, which
/// ends the app with no event to stop it (the quit alert could not ask).
// @cpt-algo:cpt-noter-algo-ui-menu-bar-build-menu:p1
pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    if let Some(MenuItemKind::Submenu(first)) = menu.items()?.into_iter().next() {
        if let Some(quit) = first.items()?.pop() {
            first.remove(&quit)?;
        }
        let item = MenuItem::with_id(app, APP_QUIT, catalogue("menu.quit_noter"), true, Some("CmdOrCtrl+Q"))?;
        first.append(&item)?;
    }
    // Fix Term… sits in the Edit menu, disabled until the window reports a confirmed-text selection.
    for kind in menu.items()? {
        if let MenuItemKind::Submenu(sub) = kind {
            if sub.text()? == "Edit" {
                sub.append(&PredefinedMenuItem::separator(app)?)?;
                sub.append(&MenuItem::with_id(
                    app,
                    APP_FIX_TERM,
                    catalogue("speakers.fix.menu"),
                    false,
                    None::<&str>,
                )?)?;
            }
        }
    }
    Ok(menu)
}

/// The Edit menu's id for **Fix Term…**.
pub const APP_FIX_TERM: &str = "AppFixTerm";

/// **Fix Term…** was chosen: the windows open the term fix on their current selection.
pub fn fix_term_chosen<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit(event_names::MENU_FIX_TERM, json!({}));
}
