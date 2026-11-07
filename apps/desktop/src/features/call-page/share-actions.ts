// The commands behind Share, Export, tags and stored audio on the call page. Each goes through `bridge.act`, so the
// control that sent it shows its own busy and error state; the core owns clipboard text, save panels and deletion.
import type { Bridge } from "../../app/bridge/bridge";
import type { ExportInclude, ShareFormat, ShareScope } from "../../core/bindings";
import { t } from "../../i18n/format";
import { askAlert } from "../../ui/dialogs/alerts";
import { holdUndo } from "../history/undo";
import { applyRecord } from "../../app/store/window-store";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-share:p1
/** `share_copy`; `unreviewed_in_scope` comes back as the command's error for the menu to explain. */
export function copyShare(bridge: Bridge, callId: string, scope: ShareScope, format: ShareFormat) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-copy
  return bridge.act(`share:copy:${callId}`, "share_copy", () => bridge.core.shareCopy({ call_id: callId, scope, format }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-copy
}

/** `calls_export`: the core shows the save panel; a whole-call export sends no scope. */
export function exportCall(bridge: Bridge, callId: string, include: ExportInclude, scope: ShareScope | null) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-export
  return bridge.act(`calls:export:${callId}`, "calls_export", () => bridge.core.callsExport({ call_ids: [callId], include, scope }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-export
}

/** The sheet's button: what the save panel and the core made of it. A cancelled panel is no error and no status. */
export async function runExport(bridge: Bridge, callId: string, include: ExportInclude, scope: ShareScope | null): Promise<{ kind: "done"; path: string } | { kind: "cancelled" | "failed" }> {
  const r = await exportCall(bridge, callId, include, scope);
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-cancel
  if (r.status === "error") return { kind: r.error.code === "cancelled" ? "cancelled" : "failed" };
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-cancel
  return { kind: "done", path: r.data.path };
}

/** **Show in Finder** for an export: the path the core returned. */
export const revealExport = (bridge: Bridge, callId: string, path: string) => bridge.act(`calls:export:reveal:${callId}`, "open_external", () => bridge.core.openExternal({ target: { type: "reveal_in_finder", path } }));

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1
/** `tags_list`: the tags in use, offered while typing. */
export const loadTags = (bridge: Bridge) => bridge.act("tags:list", "tags_list", () => bridge.core.tagsList({}));

/** `call_tags_set` for one call; the undo strip gets the change (or batch) and the returned call row replaces the held one. */
export async function setTags(bridge: Bridge, callId: string, add: string[], remove: string[]) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-set
  const r = await bridge.act(`tags:set:${callId}`, "call_tags_set", () => bridge.core.callTagsSet({ call_ids: [callId], add, remove }));
  if (r.status !== "ok") return r;
  const message = add.length ? t("tags.added", { tag: add[0]! }) : t("tags.removed", { tag: remove[0]! });
  holdUndo({ target: r.data.batch_id ? { type: "batch", batch_id: r.data.batch_id } : { type: "change", change_id: r.data.change_id }, message });
  // the call row comes back with its tags; nothing else is read again
  bridge.store.setState((st) => applyRecord(st, "call", { call: r.data.calls[0] }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-set
  return r;
}

/** **Delete Audio Now…**: the alert first (Cancel is the default), then `audio_delete`; `cancelled` sends nothing. */
export async function deleteAudio(bridge: Bridge, callId: string, ask: typeof askAlert = askAlert): Promise<"cancelled" | "deleted" | "failed"> {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-alert
  const yes = await ask({ title: t("audio.alert.title"), message: t("audio.alert.message"), cancel: t("outputs.cancel"), confirm: t("audio.alert.confirm"), destructive: true });
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-return
  if (!yes) return "cancelled"; // a cancelled alert sends nothing
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-return
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-alert
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete
  const r = await bridge.act(`audio:delete:${callId}`, "audio_delete", () => bridge.core.audioDelete({ call_ids: [callId] }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete
  if (r.status !== "ok") return "failed";
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-return
  return "deleted"; // `entity:changed call` carries `audio_deleted`: Call info and the transcript read it, outputs stay usable
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-return
}
