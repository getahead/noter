// The number of people the page last read, for the toolbar's subtitle.
import { useSyncExternalStore } from "react";

let held: number | null = null;
const listeners = new Set<() => void>();
export const holdCount = (n: number | null) => {
  held = n;
  listeners.forEach((l) => l());
};
export const useCount = (): number | null =>
  useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => held, () => held);
