// What the drawer keeps while the user works and the core has nothing to say about: the prompt draft, Diff on or off,
// the action running, the outcome of the last copy or open and a view restored by Cancel. A module store like the
// items' `local.ts`, so `actions.ts` drives it and the drawer only reads it.
import { useSyncExternalStore } from "react";

import type { ErrorCode, HandoffView, LaunchPath } from "../../core/bindings";

export interface Local {
  /** The prompt as the user typed it, not yet saved with `handoff_edit`. */
  draft?: string;
  draftRev?: number;
  showDiff?: boolean;
  pending?: "save" | "copy" | "open" | "target";
  /** `handoff_get` failed with this code. */
  loadFailed?: ErrorCode;
  /** `handoff_generate` itself was refused. */
  genFailed?: ErrorCode;
  /** The last open succeeded through this path (this drawer session). */
  opened?: LaunchPath;
  /** The last open failed with this code. */
  openFailed?: ErrorCode;
  /** **Copied** shows on the button. */
  copied?: boolean;
  error?: string;
  /** What Cancel returned: a completion event that arrives later is not shown over it. */
  restored?: HandoffView;
}

const NONE: Local = {};
let items = new Map<string, Local>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Merge `patch` into the item's state; an `undefined` value removes the field. */
export function patchLocal(id: string, patch: { [K in keyof Local]: Local[K] | undefined }) {
  const next = { ...items.get(id), ...patch };
  for (const k of Object.keys(next) as (keyof Local)[]) if (next[k] === undefined) delete next[k];
  items = new Map(items).set(id, next);
  listeners.forEach((l) => l());
}
export const localOf = (id: string): Local => items.get(id) ?? NONE;
export const useLocal = (id: string): Local => useSyncExternalStore(subscribe, () => localOf(id), () => localOf(id));
export const resetLocal = () => ((items = new Map()), listeners.forEach((l) => l()));
