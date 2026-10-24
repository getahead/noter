// The notifications' content and rules (docs/features/ui/notifications.md): titles and counts only from the string
// catalogue with plural rules, the send rule, and the permission state. macOS draws them and the core posts
// them; this is what it takes from the catalogue.
import type { NotificationAuth } from "../../core/bindings";
import { t } from "../../i18n/format";

export type Notification =
  | { kind: "summary_ready"; call: string; actionItems: number; decisions: number }
  | { kind: "summary_failed"; call: string }
  | { kind: "capture_problem"; problem: "system_audio_silent" | "microphone_off" | "engine_stopped" };

/** NT-1, NT-2 and NT-3: a title and one line, no quote and no name of what was said. */
export function notificationContent(n: Notification): { title: string; body: string } {
  switch (n.kind) {
    case "summary_ready":
      return { title: t("notif.summary_ready"), body: t("notif.summary_ready_body", { call: n.call, items: t("notif.action_items", { count: n.actionItems }), decisions: t("notif.decisions", { count: n.decisions }) }) };
    case "summary_failed":
      return { title: t("notif.summary_failed"), body: t("notif.summary_failed_body", { call: n.call }) };
    case "capture_problem":
      return n.problem === "system_audio_silent"
        ? { title: t("notif.system_audio_silent"), body: t("notif.system_audio_silent_body") }
        : n.problem === "microphone_off"
          ? { title: t("notif.microphone_off"), body: t("notif.microphone_off_body") }
          : { title: t("notif.engine_stopped"), body: t("notif.engine_stopped_body") };
  }
}

export interface SendInput {
  kind: Notification["kind"];
  /** Notifications were allowed and are not off in System Settings. */
  allowed: boolean;
  recording: boolean;
  presenting: boolean;
  /** The frontmost main window shows this call's page (`window_report_view`). */
  windowShowsCall: boolean;
  callSurfaceVisible: boolean;
}

// @cpt-algo:cpt-noter-algo-ui-notifications-send-rule:p1
export function sendRule(i: SendInput): "send" | "hold" | "drop" {
  // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-not-allowed
  if (!i.allowed) return "drop";
  // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-not-allowed
  // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-if-nt3
  if (i.kind === "capture_problem") {
    // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-nt3-drop
    if (i.presenting || i.callSurfaceVisible) return "drop";
    // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-nt3-drop
    // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-nt3-send
    return "send";
    // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-nt3-send
  }
  // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-if-nt3
  // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-window-front
  if (i.windowShowsCall) return "drop";
  // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-window-front
  // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-hold
  if (i.recording || i.presenting) return "hold";
  // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-hold
  // @cpt-begin:cpt-noter-algo-ui-notifications-send-rule:p1:inst-send
  return "send";
  // @cpt-end:cpt-noter-algo-ui-notifications-send-rule:p1:inst-send
}

// @cpt-state:cpt-noter-state-ui-notifications-permission:p1
/** NOT_ASKED, ALLOWED or DENIED, from what macOS reports (`env:changed`). */
export function permissionState(auth: NotificationAuth | undefined): "NOT_ASKED" | "ALLOWED" | "DENIED" {
  // @cpt-begin:cpt-noter-state-ui-notifications-permission:p1:inst-notasked-allowed
  if (auth === "authorized") return "ALLOWED";
  // @cpt-end:cpt-noter-state-ui-notifications-permission:p1:inst-notasked-allowed
  // @cpt-begin:cpt-noter-state-ui-notifications-permission:p1:inst-notasked-denied
  if (auth === "denied") return "DENIED";
  // @cpt-end:cpt-noter-state-ui-notifications-permission:p1:inst-notasked-denied
  return "NOT_ASKED";
}
