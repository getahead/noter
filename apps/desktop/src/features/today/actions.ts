import type { Bridge } from "../../app/bridge/bridge";
import { holdToday } from "./cache";

export const READ_KEY = "today:get";
const REFUSALS = { model_missing: "model_missing", disk_full: "disk_full", already_recording: "already_recording" } as const;

// @cpt-flow:cpt-noter-flow-ui-today-review:p1
let latest = 0;
/** `today_get`; a read superseded by a newer one is dropped, so a slow answer never overwrites a fresh one. */
export async function loadToday(bridge: Bridge) {
  const mine = ++latest;
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-get
  const res = await bridge.act(READ_KEY, "today_get", () => bridge.core.todayGet({}));
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-get
  if (mine === latest && res.status === "ok") holdToday(res.data);
  return res;
}

/** **Allow Calendar Access**: macOS asks, then Today reads the actual permission again. */
export async function allowCalendar(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-ask
  await bridge.act("today:calendar", "permission_request", () => bridge.core.permissionRequest({ kind: "calendar" }));
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-ask
  return loadToday(bridge);
}

/** **Open System Settings…** on the Calendar pane. */
export function openCalendarSettings(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-denied
  return bridge.act("today:settings", "open_external", () => bridge.core.openExternal({ target: { type: "system_settings", permission: "calendar" } }));
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-denied
}

// @cpt-flow:cpt-noter-flow-ui-today-capture:p1
/** **Record**: `capture_start` whatever the setup state; the named refusals show as the command's error. */
export function record(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-today-capture:p1:inst-start
  return bridge.act("today:record", "capture_start", () => bridge.core.captureStart({ source: "today", sensitive: false }), { named: REFUSALS });
  // @cpt-end:cpt-noter-flow-ui-today-capture:p1:inst-start
}

/** The toolbar indicator and **Open Call Screen**: the call window, without taking the call app's focus. */
export function showCall(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-today-capture:p1:inst-live
  return bridge.act("window_show_call", "window_show_call", () => bridge.core.windowShowCall({}));
  // @cpt-end:cpt-noter-flow-ui-today-capture:p1:inst-live
}

/** **Show Previous Call** and **Last time:**: the previous call's Summary. */
export function showPreviousCall(bridge: Bridge, callId: string) {
  return bridge.act("today:last_time", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: callId, tab: "summary" } }));
}
