// Responsibilities from the core native surfaces feature.
use super::*;
use noter_core::NotificationKind;
use noter_native::PostedNotification;
use noter_protocol::model::{CallPageTab, DegradedState, NavTarget};
use std::sync::atomic::AtomicU64;


/// What a notification says and where its click goes: NT-3 names the call's transcript, which
/// `notification_clicked` reads as "show the call window".
// @cpt-flow:cpt-noter-flow-ui-notifications-receive:p1
// @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-post
pub fn posted(n: &Notification) -> PostedNotification {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let (title, body, tab) = match &n.kind {
        NotificationKind::CaptureProblem(DegradedState::SystemAudioSilent { .. }) => (
            "System audio silent",
            "Recording continues with your microphone.",
            CallPageTab::Transcript,
        ),
        NotificationKind::CaptureProblem(DegradedState::MicrophoneOff { .. }) => (
            "Microphone off",
            "Only the other side of the call is recorded.",
            CallPageTab::Transcript,
        ),
        NotificationKind::CaptureProblem(_) => (
            "Not recording · engine stopped",
            "Try Again on the call screen.",
            CallPageTab::Transcript,
        ),
        // @cpt-begin:cpt-noter-algo-core-postcall-notify:p1:inst-notify-release
        // One thread per call; the click opens the call's Summary through `nav:request`.
        NotificationKind::SummaryReady => ("Summary ready", "", CallPageTab::Summary),
        NotificationKind::SummaryFailed => (
            "Summary not written",
            "Open the call to try again.",
            CallPageTab::Summary,
        ),
        // @cpt-end:cpt-noter-algo-core-postcall-notify:p1:inst-notify-release
    };
    PostedNotification {
        id: format!("ntf_{}_{}", n.call_id, NEXT.fetch_add(1, Ordering::Relaxed)),
        title: title.into(),
        body: body.into(),
        thread: n.call_id.clone(),
        target: NavTarget::CallPage {
            call_id: n.call_id.clone(),
            tab,
            span: None,
        },
    }
}
// @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-post

/// NT-3 (a capture problem) is the one notification that names the call's transcript.
// shortcut: the posted target carries the kind (noter-native passes back only a `NavTarget`);
// give NT-3 its own target if another notification ever opens the transcript.
fn is_capture_problem(target: &NavTarget) -> bool {
    matches!(
        target,
        NavTarget::CallPage {
            tab: CallPageTab::Transcript,
            ..
        }
    )
}

/// A clicked notification: NT-3 shows the call window in its layout with the degraded banner,
/// without bringing Noter forward; NT-1 and NT-2 bring the main window forward and ask it to
/// navigate to the call's page.
// @cpt-flow:cpt-noter-flow-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-core-native-surfaces-notifications:p1
// @cpt-dod:cpt-noter-dod-ui-notifications-content:p2
// @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click
pub fn notification_clicked<R: Runtime>(app: &AppHandle<R>, target: NavTarget) {
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-case-nt3
    if is_capture_problem(&target) {
        let Some(core) = core_of(app) else {
            return;
        };
        tauri::async_runtime::spawn(async move {
            let ctx = native(NativeSurface::Notification);
            let name = "window_show_call";
            let _ = dispatch_and_record(core.as_ref(), &ctx, name, json!({})).await;
        });
        return;
    }
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-case-nt3
    if let Some(main) = window(app, WindowLabel::Main) {
        let _ = main.show();
        let _ = main.set_focus();
    }
    crate::emit_navigation(app, json!(target));
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-match-click
    // @cpt-end:cpt-noter-state-ui-notifications-item:p1:inst-sent-opened
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-user-click
    // @cpt-begin:cpt-noter-flow-ui-notifications-receive:p1:inst-return-receive
    // The call window or the call's page: the place the notification names.
    // @cpt-end:cpt-noter-flow-ui-notifications-receive:p1:inst-return-receive
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-click

/// Post the prepared notification; delivery is fire-and-forget and clicks route via
/// `notification_clicked`.
pub(super) fn post(notification: &Notification) {
    // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-post
    if let Err(e) = noter_native::post_notification(&posted(notification)) {
        eprintln!("noter: a notification was not posted: {e}");
    }
    // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-post
    // @cpt-begin:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-return-notify
    // Delivery is fire-and-forget; clicks return through `notification_clicked`.
    // @cpt-end:cpt-noter-flow-core-native-surfaces-notifications:p1:inst-return-notify
}
