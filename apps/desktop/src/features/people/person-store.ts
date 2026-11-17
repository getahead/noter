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

/** Re-reads the open person (a save refused as stale, a merge): the page watches this counter. */
const reread = store(0);
let rereadHeld = 0;
export const bumpPerson = () => reread.set(++rereadHeld);
export const usePersonReread = reread.use;

/** A refused action of the person's menu (Delete): the page shows it as a banner until the next action. */
const notice = store<string | null>(null);
export const setPersonNotice = notice.set;
export const usePersonNotice = notice.use;
