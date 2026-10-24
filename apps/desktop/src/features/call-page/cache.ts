// What `call_get` and `call_types_list` return beyond the call row (which lives in the window store's entities):
// the page body reads them once and the toolbar, banner and Call info read them here, so the core is asked once.
import { useSyncExternalStore } from "react";

import type { CallDetail, CallTypeInfo } from "../../core/bindings";

export interface Extras {
  first_recorded_call: boolean;
  audio_not_stored: boolean;
  mode_used: CallDetail["mode_used"];
}

interface Held {
  extras: Map<string, Extras>;
  types: CallTypeInfo[];
}
// One WebView window has one bridge; a test that builds another calls `resetCache`.
let held: Held = { extras: new Map(), types: [] };
const listeners = new Set<() => void>();
const emit = () => {
  held = { ...held };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const holdExtras = (callId: string, d: CallDetail) => {
  held.extras.set(callId, { first_recorded_call: d.first_recorded_call, audio_not_stored: d.audio_not_stored, mode_used: d.mode_used });
  emit();
};
export const holdTypes = (types: CallTypeInfo[]) => {
  held.types = types;
  emit();
};
export const resetCache = () => {
  held = { extras: new Map(), types: [] };
  emit();
};
export const useExtras = (callId: string): Extras | undefined => useSyncExternalStore(subscribe, () => held.extras.get(callId));
export const useTypes = (): CallTypeInfo[] => useSyncExternalStore(subscribe, () => held.types);
