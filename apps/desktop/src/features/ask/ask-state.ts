// The scope the toolbar's pop-up chooses and the page asks with: both read this one store (the toolbar is a sibling of the page).
import { useSyncExternalStore } from "react";

import type { ScopePreset } from "../../core/bindings";

export interface AskState {
  presets: ScopePreset[];
  /** The chosen preset's id. */
  scopeId: string;
}

let state: AskState = { presets: [], scopeId: "all" };
const listeners = new Set<() => void>();

export const askState = (): AskState => state;
export function setAskState(patch: Partial<AskState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useAskState = (): AskState => useSyncExternalStore(subscribe, askState, askState);
