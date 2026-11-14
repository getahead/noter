// The History timeline's markup per read state, a change row's actions, the diff view, the strip and the Export Log sheet.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { ChangeRow as Change, UiPrefs } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { DiffView } from "../../ui/diff/DiffView";
import { ExportLogSheet } from "../../ui/dialogs/export-log-sheet";
import { find, rendered } from "../../ui/testing";
import { ChangeRow } from "./ChangeRow";
import { HistoryTimeline, TimelineView, type TimelineViewProps } from "./HistoryTimeline";
import { UndoStrip } from "./UndoStrip";
import { dismissUndo, holdUndo, resetUndo } from "./undo";

const sheetOpen = vi.fn();
vi.mock("../../ui/dialogs/host", () => ({ useSheet: () => ({ open: sheetOpen }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));

const prefs: UiPrefs = { time_format: "h24", first_weekday: 1, time_zone: "UTC" };
const NOW = Date.UTC(2026, 10, 5, 12);
const row = (id: string, over: Partial<Change> = {}): Change =>
  ({ id, at: NOW - 1000, actor: { type: "you" }, entity: { id: "call_1", kind: "call", label: "Backend sync" }, field: "title", before: "Sync", after: "Backend sync", summary: "Renamed the call", batch_id: null, batch_size: 1, status: "applied", undoable: true, redoable: false, ...over }) as Change;
const view = (over: Partial<TimelineViewProps> = {}): TimelineViewProps => ({
  variant: "call", state: "READY", late: false, rows: [row("a")], prefs, actor: "all", jobId: null, jobs: [], exported: null, busyTarget: null, now: NOW,
  onActor: vi.fn(), onJob: vi.fn(), onExport: vi.fn(), onRetry: vi.fn(), onReverse: vi.fn(), ...over,
});
const html = (over?: Partial<TimelineViewProps>) => renderToString(<TimelineView {...view(over)} />);

describe("TimelineView (cpt-noter-flow-ui-history-undo-read)", () => {
  it("READY lists date groups with the count and Export Log… in the call variant", () => {
    const out = html({ rows: [row("a"), row("b", { at: NOW - 86_400_000 })] });
    expect(out).toContain('data-state="ready"');
    expect(out).toContain('data-region="PC-R8"');
    expect(out).toContain(">Today</h3>");
    expect(out).toContain(">Yesterday</h3>");
    expect(out).toContain("2 changes");
    expect(out).toContain("Export Log…");
  });

  it("EMPTY reads No changes yet; a filtered empty names the filter and the filter row stays", () => {
    expect(html({ state: "EMPTY", rows: [] })).toContain("No changes yet");
    const filtered = html({ state: "FILTERED_EMPTY", rows: [], actor: "models" });
    expect(filtered).toContain("No changes by models in this history");
    expect(filtered).toContain("All");
    const job = html({ state: "FILTERED_EMPTY", rows: [], actor: "jobs", jobId: "j1", jobs: [{ id: "j1", name: "Reconcile" }] });
    expect(job).toContain("No changes by Reconcile in this history");
  });

  it("ERROR shows the section error with Try Again that repeats the read", () => {
    const p = view({ state: "ERROR", rows: [] });
    const tree = rendered(TimelineView, p);
    expect(renderToString(<TimelineView {...p} />)).toContain("Couldn’t read the history of this call.");
    const banner = find(tree, (x) => "banner" in x).props.banner as { actions: { onAction: () => void }[] };
    banner.actions[0]!.onAction();
    expect(p.onRetry).toHaveBeenCalledOnce();
  });

  it("LOADING shows the skeleton only after 300 ms", () => {
    expect(html({ state: "LOADING", rows: [], late: false })).not.toContain("pc-skel");
    expect(html({ state: "LOADING", rows: [], late: true })).toContain("pc-skel");
  });

  it("the item variant has an actor pop-up only: no job pop-up, no Export Log…", () => {
    const out = html({ variant: "item", jobs: [{ id: "j1", name: "Reconcile" }] });
    expect(out).not.toContain("Export Log…");
    expect(out).not.toContain("All jobs");
    expect(out).not.toContain('data-region="PC-R8"');
  });

  it("the job pop-up appears with jobs, and the exported path replaces the count", () => {
    const out = html({ jobs: [{ id: "j1", name: "Reconcile" }], exported: "~/Downloads/Noter log 16 Oct.json" });
    expect(out).toContain("All jobs");
    expect(out).toContain("Exported log to ~/Downloads/Noter log 16 Oct.json");
  });

  it("the row of the strip's running command shows its spinner", () => {
    const target = { type: "change", change_id: "a" } as const;
    expect(html({ busyTarget: target })).toContain('data-state="undoing"');
    expect(html({ busyTarget: { type: "change", change_id: "z" } })).not.toContain('data-state="undoing"');
  });
});

describe("ChangeRow (cpt-noter-component-ui-change-row)", () => {
  const props = (r: Change, onReverse = vi.fn()) => ({ row: r, prefs, busy: false, onReverse });
  it("an applied row offers Undo and Diff; an undone one Redo", () => {
    const applied = renderToString(<ChangeRow {...props(row("a"))} />);
    expect(applied).toContain("Undo");
    expect(applied).toContain("Diff");
    expect(applied).toContain("Backend sync · title");
    const undone = renderToString(<ChangeRow {...props(row("a", { status: "undone", undoable: false, redoable: true }))} />);
    expect(undone).toContain("Redo");
    expect(undone).toContain('data-state="undone"');
    expect(undone).not.toContain(">Undo<");
  });

  it("no Diff without before and after, no action when not undoable, batch badge and model metadata", () => {
    const out = renderToString(<ChangeRow {...props(row("a", { before: null, after: null, undoable: false, batch_id: "b1", batch_size: 37, actor: { type: "model", llm_run_id: "r", runtime: "claude_account", model: "sonnet" } }))} />);
    expect(out).not.toContain("Diff");
    expect(out).not.toContain(">Undo<");
    expect(out).toContain("batch · 37");
    expect(out).toContain("model: Claude");
    expect(out).toContain("Claude Code · sonnet");
    expect(out).toContain('data-variant="model-run"');
  });

  it("the buttons and U on the row reverse it; U ignores modified keys and inner controls", () => {
    const onReverse = vi.fn();
    const tree = rendered(ChangeRow, props(row("a"), onReverse));
    (find(tree, (p) => p.label === "Undo").props.onAction as () => void)();
    expect(onReverse).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a" }), "undo");
    const key = tree.props.onKeyDown as (e: unknown) => void;
    const li = {};
    key({ target: li, currentTarget: li, code: "KeyU", metaKey: false, ctrlKey: false, altKey: false, preventDefault: vi.fn() });
    expect(onReverse).toHaveBeenCalledTimes(2);
    key({ target: li, currentTarget: li, code: "KeyU", metaKey: true, ctrlKey: false, altKey: false, preventDefault: vi.fn() });
    key({ target: {}, currentTarget: li, code: "KeyU", metaKey: false, ctrlKey: false, altKey: false, preventDefault: vi.fn() });
    expect(onReverse).toHaveBeenCalledTimes(2);
    const undone = rendered(ChangeRow, props(row("a", { status: "undone", undoable: false, redoable: true }), onReverse));
    (undone.props.onKeyDown as (e: unknown) => void)({ target: li, currentTarget: li, code: "KeyU", metaKey: false, ctrlKey: false, altKey: false, preventDefault: vi.fn() });
    expect(onReverse).toHaveBeenLastCalledWith(expect.anything(), "redo");
  });
});

describe("DiffView (cpt-noter-component-ui-diff-view)", () => {
  it("shows inserted and deleted words, the count, and No differences", () => {
    const out = renderToString(<DiffView before="the shaman node" after="the Shaman node" title="Summary" />);
    expect(out).toContain("<del");
    expect(out).toContain("<ins");
    expect(out).toContain("2 words changed");
    expect(renderToString(<DiffView before="same" after="same" />)).toContain("No differences");
  });

  it("folds a long unchanged run", () => {
    const text = Array.from({ length: 8 }, (_, i) => `line${i}`).join("\n");
    expect(renderToString(<DiffView before={`${text}\nold`} after={`${text}\nnew`} />)).toContain("8 unchanged lines");
  });
});

describe("UndoStrip markup", () => {
  beforeEach(() => resetUndo());
  afterEach(() => dismissUndo());
  const bridge = {} as Bridge;
  it("renders nothing without an entry, then the message, context and the Undo button", () => {
    expect(renderToString(<UndoStrip bridge={bridge} />)).toBe("");
    holdUndo({ target: { type: "change", change_id: "c" }, message: "Renamed", context: "Backend sync" });
    const out = renderToString(<UndoStrip bridge={bridge} />);
    expect(out).toContain('data-component="cpt-noter-component-ui-undo-strip"');
    expect(out).toContain('data-variant="after-action"');
    expect(out).toContain("Renamed");
    expect(out).toContain("Backend sync");
    expect(out).toContain("Undo");
  });

  it("Esc on the strip hides it; hover and focus pause it", () => {
    holdUndo({ target: { type: "change", change_id: "c" }, message: "x" });
    const tree = rendered(UndoStrip, { bridge });
    (tree.props.onPointerEnter as () => void)();
    expect(renderToString(<UndoStrip bridge={bridge} />)).toContain('data-state="paused"');
    (tree.props.onPointerLeave as () => void)();
    (tree.props.onFocus as () => void)();
    (tree.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
    expect(renderToString(<UndoStrip bridge={bridge} />)).toContain('data-state="visible"');
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Enter" });
    expect(renderToString(<UndoStrip bridge={bridge} />)).not.toBe("");
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Escape" });
    expect(renderToString(<UndoStrip bridge={bridge} />)).toBe("");
  });
});

describe("ExportLogSheet (cpt-noter-flow-ui-history-undo-export)", () => {
  let bridge: Bridge;
  let fake: FakeCore;
  beforeEach(async () => {
    fake = new FakeCore({ window: "main" });
    bridge = createBridge("main", fake);
    await bridge.open();
  });
  afterEach(() => bridge.close());
  const mount = () => {
    const p = { close: vi.fn(), bridge, callId: fake.world.calls[0]!.id, callTitle: "Backend sync", onExported: vi.fn() };
    return { p, tree: rendered(ExportLogSheet, p) };
  };
  const exportNow = (tree: ReturnType<typeof mount>["tree"]) => void ((find(tree, (x) => "defaultButton" in x).props.defaultButton as { props: { onAction: () => Promise<void> } }).props.onAction)();

  it("names the call, Whole call, and Markdown by default", () => {
    const out = renderToString(<ExportLogSheet {...mount().p} />);
    expect(out).toContain("Changes of “Backend sync”");
    expect(out).toContain("Period: Whole call");
    expect(out).toContain("One line per change, for reading");
    expect(out).toContain("Every field, for scripts");
    expect(out).toContain("Markdown");
    expect(out).toContain("JSON");
  });

  it("a successful export reports the returned path and closes", async () => {
    const { p, tree } = mount();
    exportNow(tree);
    await vi.waitFor(() => expect(p.close).toHaveBeenCalledOnce());
    expect(p.onExported).toHaveBeenCalledWith(expect.stringMatching(/\.md$/));
  });

  it("a cancelled save panel closes with no status", async () => {
    const { p, tree } = mount();
    fake.failNext("history_export", "cancelled");
    exportNow(tree);
    await vi.waitFor(() => expect(p.close).toHaveBeenCalledOnce());
    expect(p.onExported).not.toHaveBeenCalled();
  });

  it("another failure keeps the sheet open", async () => {
    const { p, tree } = mount();
    fake.failNext("history_export", "internal");
    exportNow(tree);
    await vi.waitFor(() => expect(bridge.store.getState().commands["history:export"]?.state).toBe("ERROR"));
    expect(p.onExported).not.toHaveBeenCalled();
    expect(p.close).not.toHaveBeenCalled();
  });
});

describe("HistoryTimeline container (cpt-noter-component-ui-history-timeline)", () => {
  let bridge: Bridge;
  let fake: FakeCore;
  beforeEach(async () => {
    fake = new FakeCore({ window: "main" });
    bridge = createBridge("main", fake);
    await bridge.open();
    resetUndo();
    sheetOpen.mockClear();
  });
  afterEach(() => (dismissUndo(), bridge.close()));
  const mount = () => rendered(HistoryTimeline, { bridge, target: { type: "call", call_id: fake.world.calls[0]!.id }, variant: "call", callId: fake.world.calls[0]!.id, callTitle: "Backend sync" });

  it("starts loading, Export Log… opens the sheet with the call", () => {
    const tree = mount();
    expect(tree.props.state).toBe("LOADING");
    (tree.props.onExport as () => void)();
    expect(sheetOpen).toHaveBeenCalledWith("export-log", expect.objectContaining({ callTitle: "Backend sync" }));
  });

  it("a row's Undo holds the strip on the row's own target, once at a time", () => {
    const tree = mount();
    const reverse = tree.props.onReverse as (r: Change, m: "undo" | "redo") => void;
    reverse(row("chg_1"), "undo");
    expect(sheetOpen).not.toHaveBeenCalled();
    reverse(row("chg_2"), "undo"); // the first command is still running: ignored
    expect(bridge.store.getState().commands["undo:chg_1"]?.state).toBe("WAITING");
    expect(bridge.store.getState().commands["undo:chg_2"]).toBeUndefined();
  });

  it("Try Again rereads the same history target and filters", async () => {
    const tree = mount();
    const read = vi.spyOn(bridge.core, "historyList");
    (tree.props.onRetry as () => void)();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    expect(read).toHaveBeenCalledWith({ target: { type: "call", call_id: fake.world.calls[0]!.id }, actor: "all", job_id: null, page: {} });
  });
});
