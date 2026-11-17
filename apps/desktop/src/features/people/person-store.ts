// What the Person page and its toolbar share: the view being shown (Overview, Calls or History) and the person read.
import { useSyncExternalStore } from "react";

import type { PersonPage } from "../../core/bindings";

export type PersonTab = "overview" | "calls" | "history";

function store<T>(initial: T) {
  let held = initial;
  const listeners = new Set<() => void>();
  return {
    set: (v: T) => {
      held = v;
      listeners.forEach((l) => l());
    },
    use: (): T => useSyncExternalStore((l) => (listeners.add(l), () => void listeners.delete(l)), () => held, () => held),
  };
}

const tabs = store<Record<string, PersonTab>>({});
let tabHeld: Record<string, PersonTab> = {};
/** A person's view is remembered while the window lives, so Back lands on the same view. */
export const setPersonTab = (id: string, tab: PersonTab) => tabs.set((tabHeld = { ...tabHeld, [id]: tab }));
export const usePersonTab = (id: string): PersonTab => tabs.use()[id] ?? "overview";

const page = store<PersonPage | null>(null);
export const holdPerson = page.set;
export const usePersonHeld = page.use;
