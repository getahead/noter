// The Calls list's state machine (LOADING, EMPTY, LISTED, ERROR) over `calls_list`: one read per page, an answer
// older than the last request is dropped, and the core's entity events are merged in by identity.
import type { Bridge } from "../../app/bridge/bridge";
import type { CallRow, CallSort, CoreError } from "../../core/bindings";

export interface CallsState {
  status: "LOADING" | "EMPTY" | "LISTED" | "ERROR";
  rows: CallRow[];
  sort: CallSort;
  total: number | null;
  next: string | null;
  error: CoreError | null;
}

const INITIAL: CallsState = {
  status: "LOADING",
  rows: [],
  sort: "newest",
  total: null,
  next: null,
  error: null,
};

// @cpt-state:cpt-noter-state-ui-library-calls-list:p1
export function createCallsList(bridge: Bridge, from: CallsState = INITIAL) {
  let state = from;
  let request = 0;
  let more: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: Partial<CallsState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };
  const read = (sort: CallSort, cursor?: string) =>
    bridge.act(
      "calls_list",
      "calls_list",
      () =>
        bridge.core.callsList({
          filter: {},
          sort,
          page: cursor ? { cursor } : {},
        }),
      { screen: "library-calls" },
    );

  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-list
  let reading: { sort: CallSort; done: Promise<void> } | null = null;
  // StrictMode mounts a page twice in development: the same read is shared, never sent twice
  const load = (sort = state.sort): Promise<void> =>
    reading?.sort === sort
      ? reading.done
      : (reading = {
          sort,
          done: first(sort).finally(
            () => reading?.sort === sort && (reading = null),
          ),
        }).done;
  async function first(sort: CallSort): Promise<void> {
    const mine = ++request;
    // a list already on screen stays while it reloads (Back shows it at once)
    set({
      sort,
      ...(state.status === "ERROR" || !state.rows.length
        ? { status: "LOADING" as const }
        : {}),
      error: null,
    });
    const res = await read(sort);
    if (mine !== request) return;
    // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-loading-error
    if (res.status === "error")
      return set({ status: "ERROR", error: res.error });
    // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-loading-error
    // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-loading-listed
    // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-loading-empty
    set({
      status: res.data.rows.length ? "LISTED" : "EMPTY",
      rows: res.data.rows,
      total: res.data.total,
      next: res.data.next_cursor,
    });
    // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-loading-empty
    // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-loading-listed
  }
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-list

  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-next
  const nextPage = async () => {
    const mine = request;
    const res = await read(state.sort, state.next!);
    if (mine === request && res.status === "ok")
      set({
        rows: [...state.rows, ...res.data.rows],
        total: res.data.total ?? state.total,
        next: res.data.next_cursor,
      });
  };
  /** The next page, once, when the end of the loaded one is reached. */
  const loadMore = () =>
    state.next && state.status === "LISTED"
      ? (more ??= nextPage().finally(() => (more = null)))
      : Promise.resolve();
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-next

  const mergeRows = (rows: CallRow[]) => (rows.length ? "LISTED" : "EMPTY");
  return {
    get: () => state,
    subscribe: (l: () => void) => (
      listeners.add(l),
      () => void listeners.delete(l)
    ),
    load,
    more: loadMore,
    sort: (sort: CallSort) => load(sort),
    /** Newer records of the rows held (by `rev`), and a recorded call that is not listed yet, first. */
    merge(records: Record<string, CallRow>, gone: Set<string>) {
      const held = new Set(state.rows.map((r) => r.id));
      const updated = state.rows
        .filter((r) => !gone.has(r.id))
        .map((r) =>
          records[r.id] && records[r.id]!.rev > r.rev ? records[r.id]! : r,
        );
      const fresh =
        state.status === "LOADING" || state.status === "ERROR"
          ? []
          : Object.values(records).filter(
              (r) => !held.has(r.id) && !gone.has(r.id),
            );
      // shortcut: a new call goes first, which is right for the default newest-first sort; another sort shows it after the next read
      const rows = [...fresh, ...updated];
      if (
        rows.length !== state.rows.length ||
        rows.some((r, i) => r !== state.rows[i])
      )
        set({
          rows,
          status: state.status === "ERROR" ? "ERROR" : mergeRows(rows),
        });
    },
    /** Calls the core deleted. */
    drop(ids: string[]) {
      const rows = state.rows.filter((r) => !ids.includes(r.id));
      // @cpt-begin:cpt-noter-state-ui-library-calls-list:p1:inst-listed-empty
      set({
        rows,
        status: mergeRows(rows),
        total:
          state.total === null
            ? null
            : Math.max(0, state.total - (state.rows.length - rows.length)),
      });
      // @cpt-end:cpt-noter-state-ui-library-calls-list:p1:inst-listed-empty
    },
  };
}

export type CallsList = ReturnType<typeof createCallsList>;
