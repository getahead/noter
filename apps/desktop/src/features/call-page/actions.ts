import type { Bridge } from "../../app/bridge/bridge";
import type { CallRow } from "../../core/bindings";
import { extrasOf, holdExtras, holdTypes } from "./cache";
import { slots } from "./slots";

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-open:p1
/** `call_get`; the call goes into the store by identity, and a `not_found` or failure is the command's error state. */
export function loadCall(bridge: Bridge, callId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-get
  return bridge.act(readKey(callId), "call_get", () => bridge.core.callGet({ call_id: callId }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-api-get
}
/** `call_get`, and what it returns beyond the call row held for the toolbar, the banner and Call info. */
export const readCall = (bridge: Bridge, callId: string) => loadCall(bridge, callId).then((r) => (r.status === "ok" && holdExtras(callId, r.data), r));

/** Everything the page reads when it opens: the call, and the types for **Call Type ▸** and Call info's **Type**. */
export function openCallPage(bridge: Bridge, callId: string) {
  return Promise.all([readCall(bridge, callId), loadTypes(bridge).then((r) => (r.status === "ok" && holdTypes(r.data.call_types), r))]);
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
  // @cpt-begin:cpt-noter-flow-ui-library-calls-edit:p2:inst-api-update
  return bridge.act(`call:update:${callId}`, "call_update", () => bridge.core.callUpdate({ call_id: callId, rev, title }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-library-calls-edit:p2:inst-api-update
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-rename
}

export function setCallType(bridge: Bridge, callId: string, rev: number, callType: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-type
  // @cpt-begin:cpt-noter-flow-ui-library-calls-edit:p2:inst-api-update
  return bridge.act(`call:update:${callId}`, "call_update", () => bridge.core.callUpdate({ call_id: callId, rev, call_type: callType }), { entity: "call" });
  // @cpt-end:cpt-noter-flow-ui-library-calls-edit:p2:inst-api-update
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-type
}

/** The wanted state of the call's sensitivity (the menu item and the Call info switch send the same command). */
export function setSensitive(bridge: Bridge, callId: string, sensitive: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-sensitive
  return bridge.act(`call:sensitive:${callId}`, "capture_set_sensitive", () => bridge.core.captureSetSensitive({ call_id: callId, sensitive }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-sensitive
}

/** **Show in Finder**: the folder `call_get` gave; the page reads it on open, so nothing is sent before then. */
export async function revealFolder(bridge: Bridge, callId: string) {
  const path = extrasOf(callId)?.folder;
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-finder
  if (path) await bridge.act(`call:finder:${callId}`, "open_external", () => bridge.core.openExternal({ target: { type: "reveal_in_finder", path } }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-finder
}

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1
/** **Notify Me When Summaries Are Ready**: macOS shows its prompt; the banner goes away whatever the answer. */
export function requestNotifications(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-api-permission
  return bridge.act("call:notify", "permission_request", () => bridge.core.permissionRequest({ kind: "notifications" }));
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-api-permission
}

/** Return in the title field: save a changed, non-empty title; after a refusal the core's current call is read again. */
export async function saveTitle(bridge: Bridge, call: Pick<CallRow, "id" | "rev" | "title">, value: string): Promise<void> {
  if (!value.trim() || value === call.title) return;
  const r = await rename(bridge, call.id, call.rev, value);
  if (r.status === "error") await loadCall(bridge, call.id);
}

/** Call Info's Mode indicator opens Settings › Privacy. */
export const openPrivacySettings = (bridge: Bridge) => bridge.core.windowNavigate({ target: { type: "settings", pane: "privacy" } });

// @cpt-dod:cpt-noter-dod-ui-call-page-frame-actions:p2
/** What the ⋯ menu's items do for this call. Delete Call… is the dialogs host's alert, absent until it registers. */
export function menuActs(bridge: Bridge, call: Pick<CallRow, "id" | "rev" | "privacy">, startRename: () => void) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-match-more
  return {
    rename: startRename,
    type: (id: string) => void setCallType(bridge, call.id, call.rev, id),
    sensitive: () => void setSensitive(bridge, call.id, call.privacy !== "sensitive"),
    finder: () => void revealFolder(bridge, call.id),
    // @cpt-begin:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-delete
    remove: slots.deleteCall ? () => slots.deleteCall?.(bridge, call.id) : null,
    // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-case-delete
  };
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-more-menu:p1:inst-match-more
}
