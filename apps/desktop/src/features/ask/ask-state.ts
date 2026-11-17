// The scope the toolbar's pop-up chooses and the page asks with: both read this one store (the toolbar is a sibling of the page).
import { useSyncExternalStore } from "react";

import type { ScopePreset } from "../../core/bindings";

export interface AskState {
  presets: ScopePreset[];
  /** The chosen preset's id. */
  scopeId: string;
  /** Counts New Question requests (the toolbar button, ⌘N); the page opens the empty composer when it changes. */
  fresh: number;
}

let state: AskState = { presets: [], scopeId: "all", fresh: 0 };
// Presets the page added itself (a topic the core's short list does not offer): they survive a reload of the list.
let extra: ScopePreset[] = [];
const listeners = new Set<() => void>();

/** The core's preset list, plus any transient preset it does not carry. */
export const setPresets = (list: ScopePreset[]): void => setAskState({ presets: [...list, ...extra.filter((e) => !list.some((p) => p.id === e.id))] });
/** Offer one more scope in the pop-up (once). */
export function offerPreset(preset: ScopePreset): void {
  if (state.presets.some((p) => p.id === preset.id)) return;
  extra = [...extra, preset];
  setAskState({ presets: [...state.presets, preset] });
}

export const askState = (): AskState => state;
export function setAskState(patch: Partial<AskState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useAskState = (): AskState => useSyncExternalStore(subscribe, askState, askState);
export const newQuestion = (): void => setAskState({ fresh: state.fresh + 1 });
/** ⌘N. */
export const isNewKey = (e: { key: string; metaKey: boolean; shiftKey: boolean }): boolean => e.metaKey && !e.shiftKey && e.key.toLowerCase() === "n";

/** Listen for ⌘N on `doc`; returns the unlisten function. */
export function bindNewKey(doc: Pick<Document, "addEventListener" | "removeEventListener">): () => void {
  const onKey = (e: KeyboardEvent) => isNewKey(e) && (e.preventDefault(), newQuestion());
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}
