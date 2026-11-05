// The undo strip's one entry per window: what the last undoable action returned, its 10 s timer and the
// Undo/Redo it runs against the core. Every feature hands over `{ target, message }` through `holdUndo`;
// the strip never writes an inverse itself, it re-reads through `refresh`.
import { useSyncExternalStore } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { UndoResult, UndoTarget } from "../../core/bindings";
import { t } from "../../i18n/format";
import type { MsgKey } from "../../i18n/en";
import { statusTimer, type Clock, type StatusTimer } from "../../ui/feedback/status-timer";

export const UNDO_MS = 10_000;

export type UndoPhase = "VISIBLE" | "PAUSED" | "WORKING" | "SWITCHED" | "PARTIAL";

export interface UndoEntry {
  target: UndoTarget;
  message: string;
  context?: string;
  /** What the strip's button does next. */
  mode: "undo" | "redo";
  phase: UndoPhase;
}

export interface HoldUndo {
  target: UndoTarget;
  message: string;
  context?: string;
  /** Re-reads what the command touched (History, or the record's own read) once it settled. */
  refresh?: () => void | Promise<void>;
}

const NAMED: Record<string, string> = Object.fromEntries(["not_undoable", "already_undone", "not_undone", "edited_later", "undo_expired", "not_found"].map((c) => [c, c]));

let clock: Clock | undefined;
let entry: UndoEntry | null = null;
let refresh: HoldUndo["refresh"];
let timer: StatusTimer | null = null;
const held = { hover: false, focus: false };
/** The phase to return to when hover and focus both end. */
let resting: UndoPhase = "VISIBLE";
const listeners = new Set<() => void>();

const set = (e: UndoEntry | null) => {
  entry = e;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const isHeld = () => held.hover || held.focus;

/** Tests move time by hand and start from nothing. */
export function resetUndo(c?: Clock) {
  timer?.cancel();
  timer = null;
  clock = c;
  held.hover = held.focus = false;
  refresh = undefined;
  set(null);
}

function arm() {
  timer?.cancel();
  // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-show
  timer = statusTimer(UNDO_MS, dismissUndo, clock);
  // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-show
  if (isHeld() && entry) {
    timer.pause();
    resting = entry.phase;
    set({ ...entry, phase: "PAUSED" });
  }
}

// @cpt-algo:cpt-noter-algo-ui-history-undo-strip:p1
// @cpt-state:cpt-noter-state-ui-history-undo-strip:p1
export function holdUndo(h: HoldUndo) {
  refresh = h.refresh;
  // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-show
  set({ target: h.target, message: h.message, context: h.context, mode: "undo", phase: "VISIBLE" });
  // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-show
  arm();
}

export function dismissUndo() {
  // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-dismiss
  // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-hide
  timer?.cancel();
  timer = null;
  refresh = undefined;
  set(null);
  // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-hide
  // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-dismiss
}

/** Pointer or keyboard focus entered or left the strip. */
export function holdPointer(kind: "hover" | "focus", on: boolean) {
  const was = isHeld();
  held[kind] = on;
  if (!entry || entry.phase === "WORKING" || was === isHeld()) return;
  if (isHeld()) {
    // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-pause
    // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-pause
    timer?.pause();
    resting = entry.phase;
    set({ ...entry, phase: "PAUSED" });
    // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-pause
    // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-pause
  } else {
    // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-resume
    set({ ...entry, phase: resting });
    arm();
    // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-resume
  }
}

const done = (r: UndoResult, mode: "undo" | "redo") =>
  r.skipped_edited_later > 0
    ? t(mode === "undo" ? "undo.partial" : "undo.partial_redo", { done: r.undone, total: r.undone + r.skipped_edited_later, kept: r.skipped_edited_later })
    : t(mode === "undo" ? "undo.undone" : "undo.redone", { count: r.undone });

// @cpt-flow:cpt-noter-flow-ui-history-undo-reverse:p1
/** Runs the strip's action on its own target; a second call while the first runs does nothing. */
export async function runUndo(bridge: Bridge): Promise<void> {
  const e = entry;
  if (!e || e.phase === "WORKING") return;
  // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-working
  // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-work
  // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-work
  timer?.cancel();
  set({ ...e, phase: "WORKING" });
  // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-work
  // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-work
  // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-working
  const id = e.target.type === "change" ? e.target.change_id : e.target.batch_id;
  // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-call
  const res = await bridge.act(`undo:${id}`, e.mode === "undo" ? "change_undo" : "change_redo", () => (e.mode === "undo" ? bridge.core.changeUndo({ target: e.target }) : bridge.core.changeRedo({ target: e.target })), {
    named: NAMED,
    screen: "undo-strip",
  });
  // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-call
  if (entry?.target !== e.target) return; // a newer action replaced this strip while the command ran
  if (res.status === "ok") {
    const partial = res.data.skipped_edited_later > 0;
    // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-strip
    // @cpt-begin:cpt-noter-algo-ui-history-undo-strip:p1:inst-switch
    // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-undo
    // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-partial
    set({ target: e.target, message: done(res.data, e.mode), mode: e.mode === "undo" ? "redo" : "undo", phase: partial ? "PARTIAL" : "SWITCHED" });
    // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-partial
    // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-undo
    // @cpt-end:cpt-noter-algo-ui-history-undo-strip:p1:inst-switch
    // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-strip
  } else {
    // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-failed
    // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-keep
    // @cpt-begin:cpt-noter-state-ui-history-undo-strip:p1:inst-fail
    const key = `undo.err.${res.error.code}` as MsgKey;
    set({ ...e, phase: "VISIBLE", context: t(NAMED[res.error.code] ? key : "undo.err.other") });
    // @cpt-end:cpt-noter-state-ui-history-undo-strip:p1:inst-fail
    // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-keep
    // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-failed
  }
  arm();
  // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-refresh
  // @cpt-begin:cpt-noter-flow-ui-history-undo-reverse:p1:inst-finish
  await refresh?.();
  // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-finish
  // @cpt-end:cpt-noter-flow-ui-history-undo-reverse:p1:inst-refresh
}

export const useUndo = (): UndoEntry | null => useSyncExternalStore(subscribe, () => entry, () => entry);
