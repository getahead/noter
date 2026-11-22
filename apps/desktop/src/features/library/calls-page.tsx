import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useAnnounce } from "../../app/a11y/announce";
import { isModalOpen, isTyping } from "../../app/a11y/keys";
import { updateNativeMenuContext } from "../../core/native-menu";
import { moveFocus } from "../../ui/primitives/roving";
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
import { useExportCalls } from "../call-page/ExportSheet";
import { exportStore } from "./export-store";
import { AddTagPopover } from "./add-tag";
import { tagCalls, tagsKey } from "./tags";
import { FilterBar, useLists } from "./filter-bar";
import { typeLabel } from "./call-row";
import { heldFilter, holdFilter, isFiltered, reconcile, syncFilter, watchFilter, type FilterAction, type FilterState } from "./filters";
import { nextSort, sortOf, withProgress, type Column } from "./calls-model";
import {
  edgeOf,
  extend,
  NONE,
  press,
  retain,
  selectAll,
  type Selection,
} from "./selection";

// Back from a call's page remounts the page: what was on screen is shown at once (and the shell restores the scroll), then read again.
let memory: { state: CallsState; selection: Selection } | null = null;

const SLOW_MS = 300;

// @cpt-flow:cpt-noter-flow-ui-library-calls-browse:p1
export function moveCallsSelection(e: KeyboardEvent<HTMLElement>, select: (next: Selection) => void): boolean {
  if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey || !moveFocus(e, "[data-lib-row]", false)) return false;
  const id = (document.activeElement as HTMLElement | null)?.dataset.libRow;
  if (id) select({ ids: [id], anchor: id });
  return true;
}

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
export function watchCallsMenuContext(): () => void {
  let focused = true;
  const update = () => void updateNativeMenuContext({ selectAllCalls: focused && !isModalOpen() && !isTyping(document.activeElement) && !!document.activeElement?.closest('[data-lib-row], [data-region="LC-R3"] table') });
  const onFocus = () => { focused = true; update(); };
  const onBlur = () => { focused = false; update(); };
  const observer = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
  update();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  document.addEventListener?.("focusin", update);
  if (document.body) observer?.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal"] });
  return () => {
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener?.("focusin", update);
    observer?.disconnect();
    void updateNativeMenuContext({ selectAllCalls: false });
  };
}

function useCallsList(bridge: Bridge): [CallsState, CallsList] {
  const list = useMemo(() => createCallsList(bridge, memory?.state, heldFilter().filter), [bridge]);
  const state = useSyncExternalStore(list.subscribe, list.get, list.get);
  useEffect(() => void list.load(), [list]);
  return [state, list];
}

// @cpt-dod:cpt-noter-dod-ui-library-calls-table:p2
// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Calls: the list's state and the commands behind LC-R1 and LC-R3. */
export function CallsPage() {
  useEffect(watchCallsMenuContext, []);
  const bridge = useBridge();
  const [state, list] = useCallsList(bridge);
  const [selection, setSelection] = useState<Selection>(
    memory?.selection ?? NONE,
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const announce = useAnnounce(bridge);
  const [fstate, setFstate] = useState<FilterState>(heldFilter);
  const [tagging, setTagging] = useState<HTMLElement | null>(null);
  const [fresh, setFresh] = useState(0);
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
  const [exported, setExported] = useState<string | null>(null);
  const exportCalls = useExportCalls(bridge, setExported);
  useEffect(() => {
    exportStore.setOpener(exportCalls);
    return () => exportStore.setOpener(null);
  });
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
  const lists = useLists(bridge, `${fresh}:${tagsKey(state.rows)}`);
  // the core's names once the lists are read; the spaced id until then (issue 1055)
  const typeName = useMemo(() => (id: string) => lists.types.find((c) => c.id === id)?.label ?? typeLabel(id), [lists]);
  // the page's own filter changes and a # tag chosen in the toolbar both reach the list through this one watcher
  const sync = useMemo(() => syncFilter((f) => void list.setFilter(f), heldFilter().filter), [list]);
  useEffect(
    () =>
      watchFilter(() => {
        const next = heldFilter();
        setFstate(next);
        sync(next);
      }),
    [list, sync],
  );
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-query
  const onFilter = (a: FilterAction) => {
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-reconcile
    const { next } = reconcile(fstate, a);
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-reconcile
    setFstate(next);
    holdFilter(next);
  };
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-query
  const filtered = isFiltered(fstate.filter);
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-calls
  useEffect(() => {
    if (filtered && state.status === "LISTED")
      void announce({ kind: "confirmation", text: t("filters.matches", { count: state.total ?? state.rows.length }), key: `m${state.total}` });
  }, [filtered, state.total, state.status]);
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-calls
  const sheets = useSheet();
  const records = useWindow(bridge, (s) => s.entities.call);
  const progress = useWindow(bridge, (s) => s.outputs);
  const selfTestPassed = useWindow(
    bridge,
    (s) => s.whole.setup?.self_test.type === "passed",
  );
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const sentinel = useRef<HTMLDivElement>(null);
  const known = useRef<Set<string>>(new Set());

  const order = useMemo(() => state.rows.map((r) => r.id), [state.rows]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const selected = useMemo(() => new Set(selection.ids), [selection.ids]);
  useEffect(() => {
    setSelection((current) => retain(current, order));
  }, [order]);
  useEffect(() => void (memory = { state, selection }), [state, selection]);
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
  // a selection of calls still recording has nothing to export yet (issue 1053)
  const recordingOnly = useMemo(() => {
    const picked = state.rows.filter((r) => selected.has(r.id));
    return picked.length > 0 && picked.every((r) => r.status === "recording" || r.status === "paused");
  }, [state.rows, selected]);
  useEffect(() => exportStore.setIds(selection.ids, recordingOnly), [selection.ids, recordingOnly]);
  useEffect(() => () => exportStore.setIds([]), []);
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
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
  const chosen = useMemo(
    () => state.rows.filter((r) => selected.has(r.id)),
    [state.rows, selected],
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
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.defaultPrevented || isTyping(e.target) || isModalOpen()) return;
    if (moveCallsSelection(e, setSelection)) return;
    // @cpt-begin:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-user-delete
    if (e.metaKey && e.key === "Backspace" && chosen.length)
      return (e.preventDefault(), void remove(chosen));
    // @cpt-end:cpt-noter-flow-ui-dialogs-host-delete-call:p1:inst-user-delete
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
    if (e.metaKey && e.key.toLowerCase() === "e" && chosen.length)
      return (e.preventDefault(), exportStore.run());
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-filter-tag:p1:inst-export
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

  const onPress = useCallback(
    (id: string, e: MouseEvent) =>
      setSelection((current) =>
        press(current, orderRef.current, id, { meta: e.metaKey, shift: e.shiftKey }),
      ),
    [],
  );
  const onContext = useCallback(
    (id: string, e: MouseEvent) => {
      e.preventDefault();
      setSelection((current) => press(current, orderRef.current, id, { context: true }));
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [],
  );

  return (
    <CallsView
      bar={<FilterBar state={fstate} lists={lists} onAction={onFilter} />}
      actions={
        <>
          {exported && <span role="status">{t("export.done", { path: exported })}</span>}
          {tagging && chosen.length > 0 && (
            <AddTagPopover
              anchor={tagging}
              count={chosen.length}
              inUse={lists.tags.map((g) => g.tag)}
              onClose={() => setTagging(null)}
              onAdd={async (tags) => {
                const r = await tagCalls(bridge, chosen.map((c) => c.id), tags, []);
                if (r.status === "ok") setFresh((n) => n + 1);
                return r.status === "ok";
              }}
            />
          )}
        </>
      }
      filtered={filtered}
      onClearFilters={() => onFilter({ type: "clear" })}
      state={shown}
      selection={selection}
      selected={selected}
      slow={slow}
      failed={failed}
      selfTestPassed={selfTestPassed}
      prefs={prefs}
      typeName={typeName}
      menu={menu}
      sentinel={sentinel}
      onSort={sortBy}
      onPress={onPress}
      onOpen={open}
      onContext={onContext}
      onKeyDown={onKeyDown}
      onRetry={() => void list.load()}
      onRetryNext={() => void list.more()}
      // @cpt-begin:cpt-noter-flow-ui-dialogs-host-sheet:p1:inst-user-trigger
      onSelfTest={() => sheets.open("self-test")}
      // @cpt-end:cpt-noter-flow-ui-dialogs-host-sheet:p1:inst-user-trigger
      onDismissFailed={() => setFailed(null)}
      onCloseMenu={() => setMenu(null)}
      onDelete={() => void remove(chosen)}
      onRemoveTag={(tag) => void tagCalls(bridge, chosen.map((c) => c.id), [], [tag]).then((r) => r.status === "ok" && setFresh((n) => n + 1))}
      onExport={exportStore.run}
      onAddTag={() => setTagging(document.querySelector<HTMLElement>(".lb-filterbar"))}
    />
  );
}
