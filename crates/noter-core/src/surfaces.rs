//! Native surfaces, core side (TL-2): the call window's state and placement, hide for presenting,
//! the tray model, announcements, navigation and external opens. The core decides and keeps the
//! state; the native layer behind [`crate::Surfaces`] only draws it.

use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;

use crate::settings::invalid;
use crate::{lock, to_json, Core};

/// Where the call window goes: the display, the layout and whether the chosen display is gone.
/// The frame on that display is the native layer's to restore (it keeps one per display and
/// layout), clamped to the visible frame.
#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    pub display_id: Option<DisplayId>,
    pub layout: CallLayout,
    pub chosen_display_missing: bool,
}

/// The tray icon: idle, recording, paused, or copilot muted (copilot arrives in M4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayGlyph {
    Idle,
    Recording,
    Paused,
    CopilotMuted,
}

/// What a menu item does when clicked; the app maps each to a core command as `Caller::Native`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    StartRecording,
    StopRecording,
    Pause,
    Resume,
    MarkMoment,
    OpenCallScreen,
    HideForPresenting,
    ShowAfterPresenting,
    /// The new-meeting line shown while hidden for presenting.
    StartAsNewCall,
    OpenNoter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayItem {
    pub action: TrayAction,
    pub enabled: bool,
}

/// Everything the status item shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayModel {
    pub glyph: TrayGlyph,
    /// The state line: "Not recording", "Recording", "Paused".
    pub status: String,
    pub call_title: Option<String>,
    /// Where text may go (D-27: the three Settings privacy modes).
    pub privacy: PrivacyMode,
    pub items: Vec<TrayItem>,
}

/// The core's bookkeeping for the windows it asks the native layer to show.
pub(crate) struct Windows {
    call: CallWindowState,
    /// The call window was visible when presenting started.
    was_visible: bool,
    /// The share warning goes out with the first floating layout of a run.
    warned: bool,
    tray: Option<TrayModel>,
}

impl Default for Windows {
    fn default() -> Self {
        Self {
            call: CallWindowState {
                version: StateVersion(1),
                visible: false,
                key: false,
                // No display is known yet: the floating layout, as the placement says.
                layout: CallLayout::Floating,
                collapsed: false,
                display_id: None,
                chosen_display_missing: false,
                show_share_warning: false,
            },
            was_visible: false,
            warned: false,
            tray: None,
        }
    }
}

impl crate::app::WholeState for CallWindowState {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

pub(crate) fn place(
    displays: &[DisplayInfo],
    chosen: &Option<DisplayId>,
    preference: CallLayoutPreference,
) -> Placement {
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-chosen-display
    if let Some(id) = chosen
        .as_ref()
        .filter(|id| displays.iter().any(|d| d.id == **id))
    {
        let layout = match preference {
            CallLayoutPreference::Floating => CallLayout::Floating,
            CallLayoutPreference::Auto => CallLayout::Dedicated,
        };
        return Placement {
            display_id: Some(id.clone()),
            layout,
            chosen_display_missing: false,
        };
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-chosen-display
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-fallback-display
    // The main display stands for "the display with the main window".
    let main = displays.iter().find(|d| d.is_main).or(displays.first());
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-return-placement
    Placement {
        display_id: main.map(|d| d.id.clone()),
        layout: CallLayout::Floating,
        chosen_display_missing: chosen.is_some(),
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-return-placement
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-fallback-display
}

fn placement_of(call: &CallWindowState) -> Placement {
    Placement {
        display_id: call.display_id.clone(),
        layout: call.layout,
        chosen_display_missing: call.chosen_display_missing,
    }
}

fn tray_model(capture: &CaptureState, hidden: bool, privacy: PrivacyMode) -> TrayModel {
    let phase = capture.phase;
    let live = matches!(
        phase,
        CapturePhase::Starting
            | CapturePhase::Recording
            | CapturePhase::Paused
            | CapturePhase::Failed
    );
    let (glyph, status) = match phase {
        CapturePhase::Starting | CapturePhase::Recording => (TrayGlyph::Recording, "Recording"),
        CapturePhase::Paused => (TrayGlyph::Paused, "Paused"),
        CapturePhase::Failed => (TrayGlyph::Recording, "Recording stopped"),
        CapturePhase::Stopping => (TrayGlyph::Idle, "Stopping"),
        CapturePhase::Idle | CapturePhase::Stopped => (TrayGlyph::Idle, "Not recording"),
    };
    let item = |action, enabled| TrayItem { action, enabled };
    let mut items = vec![
        item(
            TrayAction::StartRecording,
            matches!(phase, CapturePhase::Idle | CapturePhase::Stopped),
        ),
        item(TrayAction::StopRecording, live),
        if phase == CapturePhase::Paused {
            item(TrayAction::Resume, true)
        } else {
            item(TrayAction::Pause, phase == CapturePhase::Recording)
        },
        item(TrayAction::MarkMoment, phase == CapturePhase::Recording),
        item(TrayAction::OpenCallScreen, live),
    ];
    if hidden {
        items.push(item(TrayAction::ShowAfterPresenting, true));
        if matches!(capture.notice, Some(CaptureNotice::NewMeeting { .. })) {
            items.push(item(TrayAction::StartAsNewCall, true));
        }
    } else {
        items.push(item(TrayAction::HideForPresenting, true));
    }
    items.push(item(TrayAction::OpenNoter, true));
    TrayModel {
        glyph,
        status: status.into(),
        call_title: capture.title.clone().filter(|_| live),
        privacy,
        items,
    }
}

impl Core {
    fn placement_for(&self, call_screen: &CallScreenSettings) -> Placement {
        let displays = self.app().environment.displays.clone();
        place(&displays, &call_screen.display_id, call_screen.layout)
    }

    fn call_screen_now(&self) -> CallScreenSettings {
        lock(&self.settings).call_screen.clone()
    }

    fn publish_call(&self, w: &mut Windows) -> CallWindowState {
        self.publish(event_names::WINDOW_CALL, &mut w.call)
    }

    /// Takes a placement into the call window's state.
    fn set_placement(w: &mut Windows, p: &Placement) {
        w.call.layout = p.layout;
        w.call.display_id = p.display_id.clone();
        w.call.chosen_display_missing = p.chosen_display_missing;
        if p.layout == CallLayout::Dedicated {
            w.call.collapsed = false;
        }
    }

    /// The share warning goes out the first time the floating panel is on screen (PM-49).
    fn warn_if_first_floating(w: &mut Windows) {
        w.call.show_share_warning = w.call.layout == CallLayout::Floating && !w.warned;
        w.warned |= w.call.layout == CallLayout::Floating;
    }

    /// Shows the call window without focus; a second request (`key_if_visible`) makes it key.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-call-window:p1
    // @cpt-state:cpt-noter-state-core-native-surfaces-call-window:p1
    pub(crate) fn show_call(&self, key_if_visible: bool) -> CallWindowState {
        let placement = self.placement_for(&self.call_screen_now());
        let presenting = self.app().presenting.hidden;
        let mut w = lock(&self.windows);
        if presenting {
            // Hidden for presenting: it comes back with everything else.
            w.was_visible = true;
            return w.call.clone();
        }
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-or-key
        if w.call.visible {
            if !key_if_visible || w.call.key {
                return w.call.clone();
            }
            // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-key
            w.call.key = true;
            // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-key
            self.deps.surfaces.make_call_window_key();
        } else {
            // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-show
            w.call.visible = true;
            w.call.key = false;
            // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-show
            Self::set_placement(&mut w, &placement);
            Self::warn_if_first_floating(&mut w);
            self.deps.surfaces.show_call_window(&placement);
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-or-key
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-emit-window
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-return-window
        self.publish_call(&mut w)
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-return-window
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-emit-window
    }

    pub(crate) fn hide_call(&self) -> CallWindowState {
        let mut w = lock(&self.windows);
        if !w.call.visible {
            return w.call.clone();
        }
        // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-hide
        w.call.visible = false;
        w.call.key = false;
        // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-hide
        self.deps.surfaces.hide_call_window();
        self.publish_call(&mut w)
    }

    /// **Got It** on the share warning (D-18): it is not shown again.
    /// shortcut: remembered for this run only, like the first floating show; store it under the
    /// call-screen settings when the warning must stay away across restarts.
    pub(crate) fn share_warning_seen(&self) -> CallWindowState {
        let mut w = lock(&self.windows);
        w.warned = true;
        w.call.show_share_warning = false;
        self.publish_call(&mut w)
    }

    pub(crate) fn call_window_now(&self) -> CallWindowState {
        self.sync_call_window();
        lock(&self.windows).call.clone()
    }

    /// At start the state takes the placement without announcing it.
    pub(crate) fn init_call_window(&self) {
        let placement = self.placement_for(&self.call_screen_now());
        Self::set_placement(&mut lock(&self.windows), &placement);
    }

    /// The state's layout and display follow the displays and settings even while the window is
    /// hidden: a command answers where the window would go.
    fn sync_call_window(&self) {
        let call_screen = self.call_screen_now();
        self.follow_call_screen(&call_screen);
    }

    pub(crate) fn set_call_layout(
        &self,
        ctx: &CommandCtx,
        args: CallLayoutArgs,
    ) -> Result<CallWindowState, CoreError> {
        let stored = lock(&self.settings).clone();
        let mut call_screen = stored.call_screen;
        if call_screen.layout != args.preference {
            call_screen.layout = args.preference;
            // The setting is the preference; its write re-places an open window.
            self.update_settings(
                ctx,
                SettingsUpdateArgs {
                    rev: stored.rev,
                    section: SettingsSection::CallScreen(call_screen),
                },
            )?;
        }
        Ok(self.call_window_now())
    }

    pub(crate) fn set_call_collapsed(&self, collapsed: bool) -> CallWindowState {
        self.sync_call_window();
        let mut w = lock(&self.windows);
        // Only the floating panel has a strip; the state goes out whole either way (the flow's
        // last step), so a window that asked sees its answer as an event too.
        if w.call.layout != CallLayout::Floating || w.call.collapsed == collapsed {
            return self.publish_call(&mut w);
        }
        // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-collapse
        // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-expand
        w.call.collapsed = collapsed;
        // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-expand
        // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-collapse
        if w.call.visible {
            self.deps
                .surfaces
                .place_call_window(&placement_of(&w.call), collapsed);
        }
        self.publish_call(&mut w)
    }

    /// The displays or the call-screen settings changed: an open window is placed again.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-display-change:p1
    pub(crate) fn follow_call_screen(&self, call_screen: &CallScreenSettings) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays
        let placement = self.placement_for(call_screen);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays
        let mut w = lock(&self.windows);
        if placement_of(&w.call) == placement {
            return;
        }
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-replace
        Self::set_placement(&mut w, &placement);
        if w.call.visible {
            Self::warn_if_first_floating(&mut w);
            self.deps
                .surfaces
                .place_call_window(&placement, w.call.collapsed);
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-replace
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-emit-displays
        self.publish_call(&mut w);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-emit-displays
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-return-display
        drop(w);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-return-display
    }

    /// Hide for presenting (wanted state): every surface goes, recording carries on.
    // @cpt-flow:cpt-noter-flow-core-native-surfaces-presenting:p1
    pub(crate) fn set_hidden_for_presenting(&self, hidden: bool) -> PresentingState {
        let state = {
            let mut app = self.app();
            if app.presenting.hidden == hidden {
                return app.presenting;
            }
            app.presenting.hidden = hidden;
            // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-emit-presenting
            self.publish(event_names::APP_PRESENTING, &mut app.presenting)
            // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-emit-presenting
        };
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-hide-restore
        {
            let mut w = lock(&self.windows);
            if hidden {
                // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-presenting
                w.was_visible = w.call.visible;
                w.call.visible = false;
                w.call.key = false;
                // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-presenting
                self.deps.surfaces.hide_all();
                self.publish_call(&mut w);
            } else {
                self.deps.surfaces.restore_all();
                // @cpt-begin:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-unhide
                if std::mem::take(&mut w.was_visible) {
                    w.call.visible = true;
                    self.publish_call(&mut w);
                }
                // @cpt-end:cpt-noter-state-core-native-surfaces-call-window:p1:inst-st-unhide
            }
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-hide-restore
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-tell-session
        if !hidden {
            // Notifications held back while presenting go out now.
            self.release_held();
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-tell-session
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-menu-new-meeting
        self.refresh_tray(None);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-menu-new-meeting
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-return-presenting
        state
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-return-presenting
    }

    /// Builds the tray model and hands it to the native layer when it changed. `privacy` is the
    /// mode from a settings write that is in progress (its lock is held).
    pub(crate) fn refresh_tray(&self, privacy: Option<PrivacyMode>) {
        let (capture, hidden) = {
            let app = self.app();
            (app.capture.clone(), app.presenting.hidden)
        };
        let mode = privacy.unwrap_or_else(|| lock(&self.settings).privacy.mode);
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-build-menu
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-glyph
        let model = tray_model(&capture, hidden, mode);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-glyph
        // @cpt-end:cpt-noter-flow-core-native-surfaces-menu-bar:p1:inst-build-menu
        let mut w = lock(&self.windows);
        if w.tray.as_ref() == Some(&model) {
            return;
        }
        w.tray = Some(model.clone());
        drop(w);
        self.deps.surfaces.set_tray(&model);
    }

    // @cpt-flow:cpt-noter-flow-core-native-surfaces-navigation:p2
    pub(crate) fn navigate(&self, target: Option<NavTarget>) {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-navigate
        let window = match &target {
            Some(NavTarget::Settings { .. }) => WindowLabel::Settings,
            Some(NavTarget::FirstRun { .. }) => WindowLabel::FirstRun,
            _ => WindowLabel::Main,
        };
        self.deps.surfaces.show_window(window);
        if let Some(target) = target {
            self.deps
                .events
                .emit(event_names::NAV_REQUEST, to_json(&target));
        }
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-navigate
    }

    pub(crate) fn announce(&self, args: AnnounceArgs) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-announce
        if args.text.trim().is_empty() {
            return Err(invalid("text", ValidationRule::Required));
        }
        self.deps.surfaces.announce(&args.text, args.politeness);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-announce
        Ok(())
    }

    pub(crate) fn open_external(&self, target: ExternalTarget) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-open-external
        match &target {
            ExternalTarget::Url { url } => {
                let https = url
                    .get(..8)
                    .is_some_and(|s| s.eq_ignore_ascii_case("https://"));
                if !https || url.len() == 8 || url.chars().any(char::is_whitespace) {
                    return Err(invalid("url", ValidationRule::InvalidFormat));
                }
            }
            // Documents arrive with the knowledge sources (M3); no citation exists before.
            ExternalTarget::Document { .. } => {
                return Err(CoreError::new(ErrorCode::NotFound, "this document"));
            }
            ExternalTarget::SystemSettings { .. } => {}
            ExternalTarget::RevealInFinder { path } => {
                let p = std::path::Path::new(path);
                let plain = p.is_absolute()
                    && !p
                        .components()
                        .any(|c| matches!(c, std::path::Component::ParentDir));
                if !plain {
                    return Err(invalid("path", ValidationRule::InvalidFormat));
                }
                if !p.exists() {
                    return Err(CoreError::new(ErrorCode::NotFound, "this location"));
                }
            }
        }
        self.deps.surfaces.open_external(&target);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-open-external
        Ok(())
    }
}
