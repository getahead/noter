import type { Bridge } from "../../app/bridge/bridge";
import { callFolder } from "./folder";

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-open:p1
/** `call_get`; the call goes into the store by identity, and a `not_found` or failure is the command's error state. */
export function loadCall(bridge: Bridge, callId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-get
  return bridge.act(readKey(callId), "call_get", () => bridge.core.callGet({ call_id: callId }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-get
}
export const readKey = (callId: string) => `call:get:${callId}`;

/** `window_report_view`: the call this window shows, so the core sends no notification for it; `null` when the page closes. */
export function reportView(bridge: Bridge, callId: string | null) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-report
  return bridge.act("window:report_view", "window_report_view", () => bridge.core.windowReportView({ call_id: callId }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-report
}

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-more-menu:p1
/** `call_types_list`, for the **Call Type ▸** submenu and Call info's **Type** row. */
export const loadTypes = (bridge: Bridge) => bridge.act("call:types", "call_types_list", () => bridge.core.callTypesList({}));

/** Rename in place: the title with the call's `rev`; a `conflict` leaves the core's values to be read again. */
export function rename(bridge: Bridge, callId: string, rev: number, title: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-rename
  return bridge.act(`call:update:${callId}`, "call_update", () => bridge.core.callUpdate({ call_id: callId, rev, title }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-rename
}

export function setCallType(bridge: Bridge, callId: string, rev: number, callType: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-type
  return bridge.act(`call:update:${callId}`, "call_update", () => bridge.core.callUpdate({ call_id: callId, rev, call_type: callType }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-type
}

/** The wanted state of the call's sensitivity (the menu item and the Call info switch send the same command). */
export function setSensitive(bridge: Bridge, callId: string, sensitive: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-sensitive
  return bridge.act(`call:sensitive:${callId}`, "capture_set_sensitive", () => bridge.core.captureSetSensitive({ call_id: callId, sensitive }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-sensitive
}

export function revealFolder(bridge: Bridge, callId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-finder
  return bridge.act(`call:finder:${callId}`, "open_external", () => bridge.core.openExternal({ target: { type: "reveal_in_finder", path: callFolder(callId) } }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-finder
}

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1
/** **Notify Me When Summaries Are Ready**: macOS shows its prompt; the banner goes away whatever the answer. */
export function requestNotifications(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-api-permission
  return bridge.act("call:notify", "permission_request", () => bridge.core.permissionRequest({ kind: "notifications" }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-api-permission
}
