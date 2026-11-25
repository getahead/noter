import { useSyncExternalStore } from "react";

import type { Bridge } from "./bridge/bridge";
import type { WindowState } from "./store/window-store";

/** Read a value of the window store and re-render when it changes (the same value on the server). */
export function useWindow<T>(bridge: Bridge, pick: (s: WindowState) => T): T {
  const get = () => pick(bridge.store.getState());
  return useSyncExternalStore(bridge.store.subscribe, get, get);
}

/** Person edits affect every call. A live transcript already receives its speaker changes on its Channel
 * (pass null); a stored call needs both kinds. With no call id the read spans all people and calls. */
export function useIdentityRevision(bridge: Bridge, callId?: string | null): number {
  return useWindow(bridge, ({ identity }) => {
    if (callId === undefined) return identity.revision;
    if (callId === null) return identity.people;
    return Math.max(identity.people, identity.calls[callId] ?? 0);
  });
}
