// What `call_get` and `call_types_list` return beyond the call row (which lives in the window store's entities):
// the page body reads them once and the toolbar, banner and Call info read them here, so the core is asked once.
import { useSyncExternalStore } from "react";

import type { CallDetail, CallTypeInfo, CoreError } from "../../core/bindings";

export interface Extras {
  first_recorded_call: boolean;
  audio_not_stored: boolean;
  mode_used: CallDetail["mode_used"];
  folder: string;
}

/** Banners the user closed with × (view state for this window's lifetime). */
export const dismissed = new Set<string>();

interface Held {
  extras: Map<string, Extras>;
  types: CallTypeInfo[];
  /** A Delete Call… the core refused, shown as the page's section error until the next try or ×. */
  deleteErrors: Map<string, CoreError>;
}
// One WebView window has one bridge; a test that builds another calls `resetCache`.
let held: Held = { extras: new Map(), types: [], deleteErrors: new Map() };
const listeners = new Set<() => void>();
const emit = () => {
  held = { ...held };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const holdExtras = (callId: string, d: Pick<CallDetail, "first_recorded_call" | "audio_not_stored" | "mode_used" | "folder">) => {
  held.extras.set(callId, { first_recorded_call: d.first_recorded_call, audio_not_stored: d.audio_not_stored, mode_used: d.mode_used, folder: d.folder });
  emit();
};
export const holdTypes = (types: CallTypeInfo[]) => {
  held.types = types;
  emit();
};
export const holdDeleteError = (callId: string, error: CoreError | null) => {
  if (error) held.deleteErrors.set(callId, error);
  else if (!held.deleteErrors.delete(callId)) return;
  emit();
};
export const resetCache = () => {
  dismissed.clear();
  held = { extras: new Map(), types: [], deleteErrors: new Map() };
  emit();
};
export const extrasOf = (callId: string): Extras | undefined => held.extras.get(callId);
export const useExtras = (callId: string): Extras | undefined => {
  const get = () => held.extras.get(callId);
  return useSyncExternalStore(subscribe, get, get);
};
export const deleteErrorOf = (callId: string): CoreError | undefined => held.deleteErrors.get(callId);
export const useDeleteError = (callId: string): CoreError | undefined => {
  const get = () => held.deleteErrors.get(callId);
  return useSyncExternalStore(subscribe, get, get);
};
export const useTypes = (): CallTypeInfo[] => useSyncExternalStore(subscribe, () => held.types, () => held.types);
