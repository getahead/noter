// What Share shows after a copy and how a shortcut or a menu item runs one. The status is view state of the window
// (2 s for a copy), so the toolbar, the section buttons and ⌘⇧C read the same one.
import { useSyncExternalStore } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { ShareFormat } from "../../core/bindings";
import { copiedLabel, scopeOf, shareState, type ShareOrigin } from "./share-logic";
import { copyShare } from "./share-actions";
import { getOutputs } from "./outputs-cache";

export type ShareStatus = { callId: string; origin: ShareOrigin; kind: "copied"; text: string } | { callId: string; origin: ShareOrigin; kind: "unreviewed"; count: number; format: ShareFormat } | { callId: string; origin: ShareOrigin; kind: "nothing" | "failed" } | null;

let status: ShareStatus = null;
const listeners = new Set<() => void>();
export const setShareStatus = (s: ShareStatus) => ((status = s), listeners.forEach((l) => l()));
export const useShareStatus = (): ShareStatus => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => status, () => status);

/** Opens the Export sheet for the call page that is showing; its toolbar registers it (⌘E reaches it from the page key). */
export const exportOpener: { open: ((origin: ShareOrigin) => void) | null } = { open: null };

/** Suggested rows the scope would carry, for the notice that makes their inclusion explicit. */
export function unreviewedIn(callId: string, origin: ShareOrigin): number {
  return (getOutputs(callId)?.sections ?? []).filter((s) => origin.type === "toolbar" || s.kind === origin.kind).flatMap((s) => s.items).filter((i) => i.review === "suggested").length;
}

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-share:p1
/** Copies the scope in a format. Not ready: the notice, no command. `unreviewed_in_scope`: the notice with Copy anyway; never silently included. */
export async function runShare(bridge: Bridge, callId: string, origin: ShareOrigin, format: ShareFormat, includeUnreviewed = false) {
  const outputs = getOutputs(callId);
  if (!shareState(outputs).ready) return setShareStatus({ callId, origin, kind: "nothing" });
  const r = await copyShare(bridge, callId, scopeOf(origin, includeUnreviewed), format);
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-review
  if (r.status === "error") return setShareStatus(r.error.code === "unreviewed_in_scope" ? { callId, origin, kind: "unreviewed", count: unreviewedIn(callId, origin), format } : { callId, origin, kind: r.error.code === "outputs_not_ready" ? "nothing" : "failed" });
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-review
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-copied
  setShareStatus({ callId, origin, kind: "copied", text: copiedLabel(format, r.data.sensitive) });
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-copied
}
