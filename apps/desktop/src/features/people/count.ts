// The people the list last read (You excluded), for the toolbar's subtitle and the New person form's duplicate check.
import { useSyncExternalStore } from "react";

import type { PersonRow } from "../../core/bindings";

let held: readonly PersonRow[] | null = null;
const listeners = new Set<() => void>();
export const holdPeople = (rows: readonly PersonRow[] | null) => {
  held = rows;
  listeners.forEach((l) => l());
};
export const usePeopleHeld = (): readonly PersonRow[] | null =>
  useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => held, () => held);
