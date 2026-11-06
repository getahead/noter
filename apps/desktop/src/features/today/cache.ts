// The last `today_get` result, held for the page and the toolbar so the core is asked once per refresh.
import { useSyncExternalStore } from "react";

import type { TodayView } from "../../core/bindings";

let held: TodayView | undefined;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const holdToday = (v: TodayView | undefined) => {
  held = v;
  listeners.forEach((l) => l());
};
export const useToday = (): TodayView | undefined => useSyncExternalStore(subscribe, () => held, () => held);
