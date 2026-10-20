import { useSyncExternalStore } from "react";

import type { Bridge } from "./bridge/bridge";
import type { WindowState } from "./store/window-store";

/** Read a value of the window store and re-render when it changes (the same value on the server). */
export function useWindow<T>(bridge: Bridge, pick: (s: WindowState) => T): T {
  const get = () => pick(bridge.store.getState());
  return useSyncExternalStore(bridge.store.subscribe, get, get);
}
