import type { Bridge } from "../../app/bridge/bridge";
import { isLive } from "../shell/live-row";
import { holdToday } from "./cache";

export const READ_KEY = "today:get";
const REFUSALS = { model_missing: "model_missing", disk_full: "disk_full", already_recording: "already_recording" } as const;

type ReadResult = Awaited<ReturnType<Bridge["core"]["todayGet"]>>;
const reads = new WeakMap<Bridge, { dirty: boolean; promise: Promise<ReadResult> }>();

// @cpt-flow:cpt-noter-flow-ui-today-review:p1
/** Coalesce one turn's refreshes; a change during a read schedules one fresh read after it. */
export function loadToday(bridge: Bridge): Promise<ReadResult> {
  const pending = reads.get(bridge);
  if (pending) {
    pending.dirty = true;
    return pending.promise;
  }
  const job = { dirty: true, promise: Promise.resolve().then(async () => {
    let res: ReadResult;
    do {
      job.dirty = false;
      // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-get
      res = await bridge.act(READ_KEY, "today_get", () => bridge.core.todayGet({}));
      // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-get
      if (!job.dirty && res.status === "ok") holdToday(res.data);
    } while (job.dirty);
    return res;
  }).finally(() => reads.delete(bridge)) };
  reads.set(bridge, job);
  return job.promise;
}

/** **Allow Calendar Access**: macOS asks, then Today reads the actual permission again. */
export async function allowCalendar(bridge: Bridge) {
  const capture = bridge.store.getState().whole.capture;
  if (capture && isLive(capture)) return loadToday(bridge);
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
  return bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: callId, tab: "summary" } }));
}
