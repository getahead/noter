//! The notification rule (`cpt-noter-algo-core-capture-session-notify`): which notification
//! goes out now, waits for the call to end, or is not sent. Delivery is the native layer's
//! ([`crate::Surfaces::post_notification`]).

use noter_protocol::model::*;
use noter_protocol::CallId;

use crate::{lock, Core};

/// A notification for the native layer to deliver.
#[derive(Debug, Clone, PartialEq)]
pub struct Notification {
    pub call_id: CallId,
    pub kind: NotificationKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum NotificationKind {
    /// NT-3: system audio silent, microphone off or capture failed.
    CaptureProblem(DegradedState),
    /// The call's outputs are ready (handed over by the post-call pipeline from M2).
    SummaryReady,
    /// No section of the call's outputs could be written.
    SummaryFailed,
}

#[derive(Debug, PartialEq)]
enum Route {
    Send,
    Hold,
    /// Not sent: a visible call surface or the menu bar shows it, or the main window shows the call.
    Skip,
}

/// What Noter shows when the notification comes.
struct Screen<'a> {
    viewed: Option<&'a CallId>,
    presenting: bool,
    surface_visible: bool,
    capturing: bool,
}

// @cpt-algo:cpt-noter-algo-core-capture-session-notify:p1
// @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-send-rule
fn route(n: &Notification, screen: &Screen) -> Route {
    // @cpt-begin:cpt-noter-algo-core-capture-session-notify:p1:inst-drop-visible
    if screen.viewed == Some(&n.call_id) {
        return Route::Skip;
    }
    // @cpt-end:cpt-noter-algo-core-capture-session-notify:p1:inst-drop-visible
    // @cpt-begin:cpt-noter-algo-core-capture-session-notify:p1:inst-if-nt3
    if matches!(n.kind, NotificationKind::CaptureProblem(_)) {
        // @cpt-begin:cpt-noter-algo-core-capture-session-notify:p1:inst-nt3-route
        // Hidden for presenting: the menu bar's degraded line shows it; a visible surface shows it.
        return if screen.presenting || screen.surface_visible {
            Route::Skip
        } else {
            Route::Send
        };
        // @cpt-end:cpt-noter-algo-core-capture-session-notify:p1:inst-nt3-route
    }
    // @cpt-end:cpt-noter-algo-core-capture-session-notify:p1:inst-if-nt3
    // @cpt-begin:cpt-noter-algo-core-capture-session-notify:p1:inst-hold-rule
    if screen.capturing || screen.presenting {
        return Route::Hold;
    }
    // @cpt-end:cpt-noter-algo-core-capture-session-notify:p1:inst-hold-rule
    // @cpt-begin:cpt-noter-algo-core-capture-session-notify:p1:inst-notify-return
    Route::Send
    // @cpt-end:cpt-noter-algo-core-capture-session-notify:p1:inst-notify-return
}
// @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-send-rule

impl Core {
    /// `window_report_view`: the call the main window shows (`None`: no call page).
    pub fn report_view(&self, call_id: Option<CallId>) {
        *lock(&self.viewed) = call_id;
    }

    /// Sends, holds or skips a notification by the hold rule of DESIGN-core 3.2.
    // @cpt-dod:cpt-noter-dod-core-capture-session-sensitive-notify:p2
    // @cpt-state:cpt-noter-state-ui-notifications-item:p1
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-core-trigger
    pub fn notify(&self, n: Notification) {
        let viewed = lock(&self.viewed).clone();
        match route(&n, &self.screen(viewed.as_ref())) {
            // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-pending-sent
            Route::Send => self.deps.surfaces.post_notification(&n),
            // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-pending-sent
            // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-pending-held
            Route::Hold => {
                // One per call: the latest.
                let mut held = lock(&self.held);
                held.retain(|h| h.call_id != n.call_id);
                held.push(n);
            }
            // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-pending-held
            // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-pending-dropped
            Route::Skip => (),
            // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-pending-dropped
        }
    }
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-core-trigger

    /// Sends what was held, once no call is captured and Noter is not hidden for presenting.
    pub(crate) fn release_held(&self) {
        let viewed = lock(&self.viewed).clone();
        let screen = self.screen(viewed.as_ref());
        if screen.capturing || screen.presenting {
            return;
        }
        let held = std::mem::take(&mut *lock(&self.held));
        // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-held-sent
        for n in held.iter().filter(|n| route(n, &screen) == Route::Send) {
            self.deps.surfaces.post_notification(n);
        }
        // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-held-sent
    }

    fn screen<'a>(&self, viewed: Option<&'a CallId>) -> Screen<'a> {
        let app = self.app();
        Screen {
            viewed,
            presenting: app.presenting.hidden,
            surface_visible: self.deps.surfaces.call_surface_visible(),
            capturing: !matches!(
                app.capture.phase,
                CapturePhase::Idle | CapturePhase::Stopped
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rule_sends_holds_or_skips() {
        let call = CallId::new("call_1".to_string());
        let other = CallId::new("call_2".to_string());
        let nt3 = Notification {
            call_id: call.clone(),
            kind: NotificationKind::CaptureProblem(DegradedState::MicrophoneOff {
                call_id: call.clone(),
            }),
        };
        let ready = Notification {
            call_id: call.clone(),
            kind: NotificationKind::SummaryReady,
        };
        let screen = |viewed, presenting, surface_visible, capturing| Screen {
            viewed,
            presenting,
            surface_visible,
            capturing,
        };
        for (n, s, want) in [
            (&nt3, screen(None, false, false, true), Route::Send),
            (&nt3, screen(None, true, false, true), Route::Skip),
            (&nt3, screen(None, false, true, true), Route::Skip),
            (&nt3, screen(Some(&call), false, false, true), Route::Skip),
            (&ready, screen(None, false, false, true), Route::Hold),
            (&ready, screen(None, true, false, false), Route::Hold),
            (&ready, screen(None, false, false, false), Route::Send),
            (
                &ready,
                screen(Some(&other), false, false, false),
                Route::Send,
            ),
            (
                &ready,
                screen(Some(&call), false, false, false),
                Route::Skip,
            ),
        ] {
            assert_eq!(route(n, &s), want, "{n:?}");
        }
    }
}
