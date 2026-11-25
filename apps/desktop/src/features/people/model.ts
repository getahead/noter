// People's list state (LOADING, READ, ERROR) over `people_list`; the query only filters it (see `view`). An answer older
// than the last request is dropped, and a list already on screen stays while it reloads.
import { useSyncExternalStore } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { CoreError, PeopleList } from "../../core/bindings";

export interface PeopleState {
  status: "LOADING" | "READ" | "ERROR";
  read: PeopleList | null;
  error: CoreError | null;
}

// @cpt-state:cpt-noter-state-ui-people-view:p1
export function createPeopleList(bridge: Bridge) {
  let state: PeopleState = { status: "LOADING", read: null, error: null };
  let request = 0;
  const listeners = new Set<() => void>();
  const set = (next: PeopleState) => {
    state = next;
    listeners.forEach((l) => l());
  };
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-list
  // StrictMode mounts a page twice in development: a read in flight is shared, never sent twice
  let reading: Promise<void> | null = null;
  let revision = 0;
  const load = (next = revision): Promise<void> => {
    if (reading && revision === next) return reading;
    revision = next;
    const pending = read().finally(() => { if (reading === pending) reading = null; });
    reading = pending;
    return pending;
  };
  const read = async (): Promise<void> => {
    const mine = ++request;
    if (!state.read) set({ status: "LOADING", read: null, error: null });
    const res = await bridge.act("people:page", "people_list", () => bridge.core.peopleList({}), { screen: "people" });
    if (mine !== request) return;
    // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-error
    if (res.status === "error") return set({ status: "ERROR", read: state.read, error: res.error });
    // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-error
    set({ status: "READ", read: res.data, error: null });
  };
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-list
  return { load, get: () => state, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) };
}

export type PeopleList$ = ReturnType<typeof createPeopleList>;

// The search text lives with the toolbar's field and the page's list: one per window.
let query = "";
const watchers = new Set<() => void>();
export const setPeopleQuery = (q: string) => {
  query = q;
  watchers.forEach((w) => w());
};
export const usePeopleQuery = (): string =>
  useSyncExternalStore((w) => (watchers.add(w), () => void watchers.delete(w)), () => query, () => query);
