// What a row keeps while the user works on it and the core has nothing to say about: the edit draft and phase,
// the outcome being shown (**Accepted**, **Rejected · Undo**), the open handoff question and the last error.
// A module store like the undo strip's, so the commands in `actions.ts` drive it and the rows only read it.
import { useSyncExternalStore } from "react";

import type { UndoTarget } from "../../core/bindings";
import type { Draft } from "./review";

export interface Outcome {
  text: string;
  /** What **Undo** reverses (the change the command returned); none for a plain confirmation. */
  target: UndoTarget | null;
  /** How long it shows. */
  ms: number;
}

export interface Local {
  phase?: "editing" | "saving";
  draft?: Draft;
  outcome?: Outcome;
  /** **Did the handoff land?** is open. */
  asking?: boolean;
  error?: string;
  /** The edit was saved but its acceptance failed: only the acceptance is retried. */
  retryAccept?: boolean;
}

const NONE: Local = {};
let rows = new Map<string, Local>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** Merge `patch` into the row's local state; an `undefined` value removes the field. */
export function patchLocal(id: string, patch: { [K in keyof Local]: Local[K] | undefined }) {
  const next = { ...rows.get(id), ...patch };
  for (const k of Object.keys(next) as (keyof Local)[]) if (next[k] === undefined) delete next[k];
  rows = new Map(rows).set(id, next);
  listeners.forEach((l) => l());
}
export const localOf = (id: string): Local => rows.get(id) ?? NONE;
export const useLocal = (id: string): Local => useSyncExternalStore(subscribe, () => localOf(id), () => localOf(id));
/** Every row's local state, for a list that depends on several (the Rejected list). */
export const useLocals = () => useSyncExternalStore(subscribe, () => rows, () => rows);
export const resetLocal = () => ((rows = new Map()), listeners.forEach((l) => l()));
