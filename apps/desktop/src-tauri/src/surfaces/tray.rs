// Responsibilities from the core native surfaces feature.
use super::*;
use noter_protocol::model::NavTarget;
use noter_protocol::PermissionKind;
use noter_core::{TrayAction, TrayEntry, TrayGlyph, TrayModel};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, MenuItem, MenuItemKind, PredefinedMenuItem};


/// The core command a menu bar item runs, with its arguments from the current snapshot; `None`
/// when the item needs a call that is gone, or is the host's own (Quit Noter). `checked` is the
/// item's checkmark as the menu showed it.
pub fn tray_command(
    action: TrayAction,
    checked: bool,
    snap: &AppSnapshot,
) -> Option<(&'static str, Value)> {
    let call = || snap.capture.call_id.clone();
    let navigate = |target: Option<NavTarget>| ("window_navigate", json!({ "target": target }));
    // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-match-item
    // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-match-start
    Some(match action {
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-start
        TrayAction::StartRecording | TrayAction::StartDetected => {
            let detection_id = snap.detection.detection.as_ref().map(|d| d.id.clone());
            let args =
                json!({ "source": "menu_bar", "sensitive": false, "detection_id": detection_id });
            ("capture_start", args)
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-start
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-stop
        TrayAction::StopRecording => ("capture_stop", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-stop
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-pause
        TrayAction::Pause => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": true }),
        ),
        TrayAction::Resume => (
            "capture_set_paused",
            json!({ "call_id": call()?, "paused": false }),
        ),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-pause
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-mark
        TrayAction::MarkMoment => ("capture_mark_moment", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-mark
        TrayAction::KeepRecording => (
            "capture_answer_call_end",
            json!({ "call_id": call()?, "choice": "keep_recording" }),
        ),
        TrayAction::StopNow => (
            "capture_answer_call_end",
            json!({ "call_id": call()?, "choice": "stop_now" }),
        ),
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-new-meeting
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-new-meeting
        TrayAction::StartAsNewCall => (
            "capture_answer_new_meeting",
            json!({ "call_id": call()?, "choice": "start_as_new_call" }),
        ),
        TrayAction::KeepInThisCall => (
            "capture_answer_new_meeting",
            json!({ "call_id": call()?, "choice": "keep_in_this_call" }),
        ),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-new-meeting
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-new-meeting
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-try-again
        TrayAction::TryAgain => ("capture_resume_interrupted", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-try-again
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-continue
        TrayAction::ContinueRecording => ("capture_continue", json!({ "call_id": call()? })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-continue
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
        TrayAction::OpenCallScreen => ("window_show_call", json!({})),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-floating
        TrayAction::UseFloatingPanel => {
            let preference = if checked { "auto" } else { "floating" };
            (
                "window_set_call_layout",
                json!({ "preference": preference }),
            )
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-floating
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-hide
        TrayAction::HideForPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": true }))
        }
        TrayAction::ShowAfterPresenting => {
            ("app_set_hidden_for_presenting", json!({ "hidden": false }))
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-hide
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-finish
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-finish-setup
        // The first-run window opens at the step where setup stopped.
        TrayAction::FinishSetup => navigate(Some(NavTarget::FirstRun { step: None })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-finish-setup
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-if-finish
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-navigate
        TrayAction::OpenNoter => navigate(None),
        TrayAction::OpenLastSummary => navigate(Some(NavTarget::LastSummary)),
        TrayAction::OpenSettings => navigate(Some(NavTarget::Settings {
            pane: SettingsPane::General,
        })),
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-navigate
        TrayAction::QuitNoter => return None,
    })
    // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-match-start
    // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-match-item
}

const ACTIONS: [TrayAction; 21] = [
    TrayAction::StartDetected,
    TrayAction::FinishSetup,
    TrayAction::KeepRecording,
    TrayAction::StopNow,
    TrayAction::StartAsNewCall,
    TrayAction::KeepInThisCall,
    TrayAction::TryAgain,
    TrayAction::ContinueRecording,
    TrayAction::StartRecording,
    TrayAction::StopRecording,
    TrayAction::Pause,
    TrayAction::Resume,
    TrayAction::MarkMoment,
    TrayAction::OpenCallScreen,
    TrayAction::UseFloatingPanel,
    TrayAction::OpenLastSummary,
    TrayAction::HideForPresenting,
    TrayAction::ShowAfterPresenting,
    TrayAction::OpenNoter,
    TrayAction::OpenSettings,
    TrayAction::QuitNoter,
];

/// A menu item's id is its action's name.
pub fn action_of(id: &str) -> Option<TrayAction> {
    ACTIONS.into_iter().find(|a| format!("{a:?}") == id)
}

/// The template glyph image: the page, its state mark and, hidden for presenting, the eye-slash
/// badge (docs/prototype `GLYPH` and `EYE`, 36 px for 18 pt).
pub fn glyph_image(glyph: TrayGlyph, hidden: bool) -> Image<'static> {
    match (glyph, hidden) {
        (TrayGlyph::Idle, false) => tauri::include_image!("icons/tray/idle.png"),
        (TrayGlyph::Idle, true) => tauri::include_image!("icons/tray/idle-hidden.png"),
        (TrayGlyph::Recording, false) => tauri::include_image!("icons/tray/recording.png"),
        (TrayGlyph::Recording, true) => tauri::include_image!("icons/tray/recording-hidden.png"),
        (TrayGlyph::Paused, false) => tauri::include_image!("icons/tray/paused.png"),
        (TrayGlyph::Paused, true) => tauri::include_image!("icons/tray/paused-hidden.png"),
        // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-muted
        // Drawn once the copilot can mute (M4, behind its flag); the core never asks for it yet.
        (TrayGlyph::CopilotMuted, false) => tauri::include_image!("icons/tray/muted.png"),
        (TrayGlyph::CopilotMuted, true) => tauri::include_image!("icons/tray/muted-hidden.png"),
        // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-muted
    }
}

/// Two menus with the same items, keys and separators in the same order: the open menu can take
/// the new texts in place (macOS keeps showing the menu it opened).
pub fn same_shape(a: &TrayModel, b: &TrayModel) -> bool {
    let shape = |m: &TrayModel| -> Vec<String> {
        m.entries
            .iter()
            .map(|e| match e {
                TrayEntry::Line(_) => "line".into(),
                TrayEntry::Separator => "-".into(),
                TrayEntry::Item(i) => {
                    format!("{:?} {:?} {:?}", i.action, i.checked.is_some(), i.key)
                }
            })
            .collect()
    };
    shape(a) == shape(b)
}

/// The System Settings pane a permission's **Open System Settings…** opens.
pub fn settings_url(permission: PermissionKind) -> &'static str {
    match permission {
        PermissionKind::Microphone => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        PermissionKind::SystemAudio => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"
        }
        PermissionKind::Calendar => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
        }
        PermissionKind::Notifications => {
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        }
        PermissionKind::ScreenRecording => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        PermissionKind::AutomationTerminal | PermissionKind::AutomationBrowser => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
        }
    }
}

impl<R: Runtime> TauriSurfaces<R> {
    /// Shows the latest model `set_tray` was given; on the main thread only.
    pub(super) fn show_tray(&self) {
        let Some(model) = lock(&self.wanted).take() else {
            return;
        };
        let model = &model;
        let mut shown = lock(&self.menu);
        let glyph = (model.glyph, model.hidden);
        let new_glyph = shown.as_ref().map(|(m, _)| (m.glyph, m.hidden)) != Some(glyph);
        let menu = match shown.take() {
            Some((old, menu)) if same_shape(&old, model) => {
                let _ = Self::update_menu(&menu, model);
                Some(menu)
            }
            _ => None,
        };
        let rebuilt = menu.is_none();
        let Some(menu) = menu.or_else(|| self.menu(model).ok()) else {
            return;
        };
        let mut tray = lock(&self.tray);
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-open
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-user-check
        if tray.is_none() {
            let this = self.this.get().cloned().unwrap_or_default();
            let builder = TrayIconBuilder::with_id("noter")
                .icon(glyph_image(model.glyph, model.hidden))
                .icon_as_template(true)
                .on_menu_event(move |_, event| {
                    // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-item
                    // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-user-start
                    let surfaces = this.upgrade();
                    if let (Some(surfaces), Some(action)) =
                        (surfaces, action_of(event.id().as_ref()))
                    {
                        surfaces.menu_clicked(action);
                    }
                    // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-user-start
                    // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-item
                });
            *tray = builder.build(&self.app).ok();
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-user-check
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-user-open
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-core-show
        if let Some(tray) = tray.as_ref() {
            if rebuilt {
                let _ = tray.set_menu(Some(menu.clone()));
            }
            if new_glyph {
                let _ = tray.set_icon_with_as_template(Some(glyph_image(glyph.0, glyph.1)), true);
            }
            let _ = tray.set_title(model.title.as_deref());
            let _ = tray.set_tooltip(Some(model.label.as_str()));
            Self::set_accessibility_label(tray, &model.label);
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-core-show
        let floating = model
            .item(TrayAction::UseFloatingPanel)
            .and_then(|i| i.checked);
        self.floating
            .store(floating == Some(true), Ordering::Relaxed);
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-return-check
        *shown = Some((model.clone(), menu));
        // @cpt-end:cpt-noter-flow-ui-menu-bar-check-state:p1:inst-return-check
    }

    /// A menu bar click, run as the menu bar surface.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-menu-bar:p1
    // @cpt-dod:cpt-noter-dod-core-native-surfaces-menu-bar:p1
    pub(super) fn menu_clicked(&self, action: TrayAction) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-menu-click
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-quit
        if action == TrayAction::QuitNoter {
            quit(&self.app);
            return;
        }
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-case-quit
        // Not the menu lock: this runs on the main thread, which `set_tray` waits for under it.
        let checked =
            action == TrayAction::UseFloatingPanel && self.floating.load(Ordering::Relaxed);
        let Some(core) = self.core.get().and_then(Weak::upgrade) else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let ctx = native(NativeSurface::MenuBar);
            let Ok(snap) = core.app_snapshot(&ctx, NoArgs {}).await else {
                return;
            };
            let Some((name, args)) = tray_command(action, checked, &snap) else {
                return;
            };
            // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
            // Open Call Screen ends hidden mode before it shows the window.
            if action == TrayAction::OpenCallScreen && snap.presenting.hidden {
                let show = json!({ "hidden": false });
                let unhide = "app_set_hidden_for_presenting";
                let _ = dispatch_json(core.as_ref(), &ctx, unhide, show, None).await;
            }
            // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-case-open-call
            // A refusal (the call ended meanwhile) is an answer, not a failure: the menu
            // shows the item disabled at the next update.
            let _ = dispatch_and_record(core.as_ref(), &ctx, name, args).await;
        });
        // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-menu-click
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-return-menu
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-return-control
        // @cpt-begin:cpt-noter-flow-ui-menu-bar-start:p1:inst-return-start
        // Every item runs one command as the menu bar and opens no dialog but the quit alert.
        // @cpt-end:cpt-noter-flow-ui-menu-bar-start:p1:inst-return-start
        // @cpt-end:cpt-noter-flow-ui-menu-bar-control-recording:p1:inst-return-control
        // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-return-menu
    }

    pub(super) fn menu(&self, tray: &TrayModel) -> tauri::Result<Menu<R>> {
        let app = &self.app;
        let menu = Menu::new(app)?;
        for entry in &tray.entries {
            match entry {
                TrayEntry::Line(line) => {
                    menu.append(&MenuItem::new(app, line, false, None::<&str>)?)?;
                }
                TrayEntry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
                TrayEntry::Item(item) => {
                    let id = format!("{:?}", item.action);
                    debug_assert!(action_of(&id).is_some(), "tray action {id} has no click handler");
                    let (label, key) = (&item.label, item.key.as_deref());
                    match item.checked {
                        Some(checked) => menu.append(&CheckMenuItem::with_id(
                            app,
                            id,
                            label,
                            item.enabled,
                            checked,
                            key,
                        )?)?,
                        None => {
                            menu.append(&MenuItem::with_id(app, id, label, item.enabled, key)?)?
                        }
                    }
                }
            }
        }
        Ok(menu)
    }

    /// The new texts, states and checkmarks into the menu on screen, item by item.
    pub(super) fn update_menu(menu: &Menu<R>, tray: &TrayModel) -> tauri::Result<()> {
        for (entry, kind) in tray.entries.iter().zip(menu.items()?) {
            match (entry, kind) {
                (TrayEntry::Line(line), MenuItemKind::MenuItem(i)) => i.set_text(line)?,
                (TrayEntry::Item(item), MenuItemKind::MenuItem(i)) => {
                    i.set_text(&item.label)?;
                    i.set_enabled(item.enabled)?;
                }
                (TrayEntry::Item(item), MenuItemKind::Check(i)) => {
                    i.set_text(&item.label)?;
                    i.set_enabled(item.enabled)?;
                    i.set_checked(item.checked == Some(true))?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// The VoiceOver label of the status item's button (tray-icon sets only its tooltip).
    pub(super) fn set_accessibility_label(tray: &TrayIcon<R>, label: &str) {
        let label = label.to_string();
        let _ = tray.with_inner_tray_icon(move |inner| {
            if let Some(item) = inner.ns_status_item() {
                let label = objc2_foundation::NSString::from_str(&label);
                // SAFETY: `button` and `setAccessibilityLabel:` are NSStatusItem and NSView API
                // taking and returning objects; this runs on the main thread (the tray's).
                unsafe {
                    let button: Option<objc2::rc::Retained<objc2::runtime::AnyObject>> =
                        objc2::msg_send![&*item, button];
                    if let Some(button) = button {
                        let _: () = objc2::msg_send![&*button, setAccessibilityLabel: &*label];
                    }
                }
            }
        });
    }
}
