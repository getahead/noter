import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { useAnnounce } from "../../app/a11y/announce";
import type { Bridge } from "../../app/bridge/bridge";
import { useBridge } from "../../app/bridge/context";
import { useWindow } from "../../app/use-window";
import type { CallRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { deleteCalls } from "../../ui/dialogs/delete-calls";
import { useSheet } from "../../ui/dialogs/host";
import { SelfTestSheet } from "../settings/SelfTestSheet";
import { createCallsList, type CallsList, type CallsState } from "./calls-list";
import { CallsView, COLUMNS } from "./calls-view";
import { nextSort, sortOf, withProgress, type Column } from "./calls-model";
import {
  edgeOf,
  extend,
  NONE,
  press,
  selectAll,
  type Selection,
} from "./selection";

// Back from a call's page remounts the page: what was on screen is shown at once (and the shell restores the scroll), then read again.
let memory: { state: CallsState; selection: Selection } | null = null;

const SLOW_MS = 300;

function useCallsList(bridge: Bridge): [CallsState, CallsList] {
  const list = useMemo(() => createCallsList(bridge, memory?.state), [bridge]);
  const state = useSyncExternalStore(list.subscribe, list.get, list.get);
  useEffect(() => void list.load(), [list]);
  return [state, list];
}

// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Calls: the list's state and the commands behind LC-R1 and LC-R3. */
export function CallsPage() {
  const bridge = useBridge();
  const [state, list] = useCallsList(bridge);
  const [selection, setSelection] = useState<Selection>(
    memory?.selection ?? NONE,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const announce = useAnnounce(bridge);
  const sheets = useSheet();
  const records = useWindow(bridge, (s) => s.entities.call);
  const progress = useWindow(bridge, (s) => s.outputs);
  const selfTestPassed = useWindow(
    bridge,
    (s) => s.whole.setup?.self_test.type === "passed",
  );
  const sentinel = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string>>(new Set());

  useEffect(() => void (memory = { state, selection }), [state, selection]);
  // a record the core changed replaces its row, a call it removed leaves the list
  useEffect(() => {
    const gone = new Set([...known.current].filter((id) => !(id in records)));
    known.current = new Set(Object.keys(records));
    if (gone.size) list.drop([...gone]);
    list.merge(records, gone);
  }, [records, list]);
  useEffect(
    () =>
      sheets.register("self-test", ({ close }) => (
        <SelfTestSheet bridge={bridge} onClose={close} />
      )),
    [sheets, bridge],
  );
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-return-browse
  useEffect(() => {
    if (state.status !== "LOADING") return setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [state.status]);
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-return-browse
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-scroll
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (e) => e.some((x) => x.isIntersecting) && void list.more(),
    );
    io.observe(el);
    return () => io.disconnect();
  }, [list, state.rows.length, state.next]);
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-user-scroll

  // shortcut: the latest progress wins over the row's own status until the next read; the core ends every write with a progress event
  const shown = useMemo(() => ({ ...state, rows: withProgress(state.rows, progress) }), [state, progress]);
  const order = useMemo(() => state.rows.map((r) => r.id), [state.rows]);
  const chosen = useMemo(
    () => state.rows.filter((r) => selection.ids.includes(r.id)),
    [state.rows, selection],
  );

  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-open-call
  const open = useCallback(
    (id: string) =>
      void bridge.act(
        "window_navigate",
        "window_navigate",
        () =>
          bridge.core.windowNavigate({
            target: { type: "call_page", call_id: id, tab: "summary" },
          }),
        { screen: "library-calls" },
      ),
    [bridge],
  );
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-open-call
  // @cpt-dod:cpt-noter-dod-ui-library-calls-delete:p2
  // @cpt-begin:cpt-noter-flow-ui-library-calls-delete:p1:inst-delete-flow
  const remove = useCallback(
    async (calls: CallRow[]) => {
      setFailed(null);
      const res = await deleteCalls(
        bridge,
        calls.map((c) => ({ id: c.id, title: c.title })),
      );
      if (res.outcome === "failed")
        return setFailed(
          res.error.code === "already_recording"
            ? t("dialogs.delete_calls.recording")
            : t("library.calls.delete_failed"),
        );
      // @cpt-begin:cpt-noter-flow-ui-library-calls-delete:p1:inst-rows-leave
      if (res.outcome === "deleted") {
        list.drop(calls.map((c) => c.id));
        setSelection(NONE);
      }
      // @cpt-end:cpt-noter-flow-ui-library-calls-delete:p1:inst-rows-leave
    },
    [bridge, list],
  );
  // @cpt-end:cpt-noter-flow-ui-library-calls-delete:p1:inst-delete-flow
  // @cpt-begin:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-sort
  const sortBy = (col: Column) => {
    const sort = nextSort(state.sort, col);
    void list.sort(sort);
    const direction = t(
      sortOf(sort, col) === "asc" ? "library.sort.asc" : "library.sort.desc",
    );
    void announce({
      kind: "confirmation",
      text: t("library.sorted", { column: t(COLUMNS[col]), direction }),
      key: sort,
    });
  };
  // @cpt-end:cpt-noter-flow-ui-library-calls-browse:p1:inst-api-sort

  // @cpt-begin:cpt-noter-flow-ui-library-calls-delete:p1:inst-user-delete
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey && e.key === "Backspace" && chosen.length)
      return (e.preventDefault(), void remove(chosen));
    if (e.metaKey && e.key.toLowerCase() === "a")
      return (e.preventDefault(), setSelection(selectAll(order)));
    if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const next = extend(selection, order, e.key === "ArrowDown" ? 1 : -1);
      setSelection(next);
      Array.from(document.querySelectorAll<HTMLElement>("[data-lib-row]"))
        .find((el) => el.dataset.libRow === edgeOf(next, order))
        ?.focus();
    }
  };
  // @cpt-end:cpt-noter-flow-ui-library-calls-delete:p1:inst-user-delete

  return (
    <CallsView
      state={shown}
      selection={selection}
      slow={slow}
      failed={failed}
      selfTestPassed={selfTestPassed}
      menu={menu}
      sentinel={sentinel}
      onSort={sortBy}
      onPress={(id, e) =>
        setSelection(
          press(selection, order, id, { meta: e.metaKey, shift: e.shiftKey }),
        )
      }
      onOpen={open}
      onContext={(id, e) => {
        e.preventDefault();
        setSelection(press(selection, order, id, { context: true }));
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onKeyDown={onKeyDown}
      onRetry={() => void list.load()}
      onSelfTest={() => sheets.open("self-test")}
      onDismissFailed={() => setFailed(null)}
      onCloseMenu={() => setMenu(null)}
      onDelete={() => void remove(chosen)}
    />
  );
}
