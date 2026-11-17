import { useEffect, useSyncExternalStore } from "react";

// What the topic thread tells its toolbar's ⋯ menu: Rename… and Merge With… (DESIGN TH-R1). One per window.
export interface MenuEntry {
  label: string;
  onAction: () => void;
}
const NONE: MenuEntry[] = [];
let menu: MenuEntry[] = NONE;
const listeners = new Set<() => void>();
export const setThreadMenu = (next: MenuEntry[]) => {
  menu = next;
  listeners.forEach((l) => l());
};
export const useThreadMenu = () => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => menu, () => menu);
/** Publishes the menu while the thread is shown (`entries` must keep its identity), and clears it on leaving. */
export const usePublishThreadMenu = (entries: MenuEntry[] | null) =>
  useEffect(() => (setThreadMenu(entries ?? NONE), () => setThreadMenu(NONE)), [entries]);
