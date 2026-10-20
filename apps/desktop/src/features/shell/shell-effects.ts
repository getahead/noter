// The window's behaviour that is not drawing: what each shell action does to the view state, how a navigation request
// of the core moves the history, the page's scroll memory, focus after navigation and the width watcher. Kept out of
// the component so each one is tested on its own (the unit environment has no DOM).
import { createFocusReturn, type FocusTarget } from "../../app/a11y/focus";
import type { NavTarget } from "../../core/bindings";
import type { History, HistoryMove } from "./history";
import type { ShellAction } from "./menu-model";
import { navRoute } from "./sections";
import type { ShellEvent } from "./shell-state";

/** The view-state event of a shell action; null for the ones the window runs itself (search focus, Settings). */
export function actionEvent(a: ShellAction, overlay: boolean, hasInspector: boolean): ShellEvent | null {
  switch (a.type) {
    case "section":
      return { type: "move", move: { type: "section", section: a.section } };
    case "back":
    case "forward":
      return { type: "move", move: { type: a.type } };
    case "toggle-sidebar":
      return { type: "toggle-sidebar", overlay };
    case "toggle-inspector":
      return hasInspector ? { type: "toggle-inspector" } : null;
    case "zoom":
      return { type: "zoom", to: a.to };
    default:
      return null;
  }
}

/** Esc closes the inspector first, then the overlay sidebar (a popover has already taken its own Esc). */
export const escapeEvent = (h: Pick<History, "inspectorOpen">): ShellEvent => ({ type: h.inspectorOpen ? "close-inspector" : "close-overlay" });

/** Where the core's `nav:request` lands in the history, or null when another window shows it. */
export function navMove(target: NavTarget): HistoryMove | null {
  const route = navRoute(target);
  if (!route) return null;
  return route.key === "root" ? { type: "section", section: route.section } : { type: "push", route };
}

/** Each page's scroll position, so Back and Forward return to where the user left it. */
export function createScrollMemory() {
  const tops = new Map<string, number>();
  return { save: (id: string, top: number) => void tops.set(id, top), top: (id: string) => tops.get(id) ?? 0 };
}

/** Moves focus to the page's first heading after navigation; false when the page has none. */
export function focusHeading(root: { querySelector(selector: string): HTMLElement | null } | null): boolean {
  const heading = root?.querySelector("h1, h2, h3");
  if (!heading) return false;
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
  return true;
}

type WidthSource = { innerWidth: number; addEventListener(type: "resize", f: () => void): void; removeEventListener(type: "resize", f: () => void): void };
/** Reports the window's width on every resize; returns the cleanup. */
export function watchWidth(win: WidthSource, set: (width: number) => void): () => void {
  const on = () => set(win.innerWidth);
  win.addEventListener("resize", on);
  return () => win.removeEventListener("resize", on);
}

/** Flags the navigation effects share: the first render moves no focus, and neither does a page the core asked for. */
export interface NavFlags {
  first: boolean;
  quiet: boolean;
}

/** A `nav:request` of the core moves the history; the heading is not focused for it. */
export function navEffect(nav: NavTarget | null, flags: NavFlags, dispatch: (e: ShellEvent) => void): void {
  const move = nav && navMove(nav);
  if (!move) return;
  flags.quiet = true;
  dispatch({ type: "move", move });
}

/** Restores the page's scroll position on arrival; the cleanup saves it on leaving. */
export function scrollEffect(el: { scrollTop: number } | null, memory: ReturnType<typeof createScrollMemory>, id: string): () => void {
  if (el) el.scrollTop = memory.top(id);
  return () => void (el && memory.save(id, el.scrollTop));
}

/** After navigation the page heading takes focus, except on the first render and for a page the core asked for. */
export function focusEffect(flags: NavFlags, root: Parameters<typeof focusHeading>[0]): void {
  if (flags.first) return void (flags.first = false);
  if (flags.quiet) return void (flags.quiet = false);
  focusHeading(root);
}

/** The inspector's exit slide, in ms: purely visual, and none under Reduce Motion (D-13). */
export const exitMs = (): number => (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 250);

/** While the inspector leaves, keeps it drawn for the slide and then calls `done`; returns the cleanup. */
export function leaveTimer(leaving: boolean, done: () => void, ms: number = exitMs()): (() => void) | undefined {
  if (!leaving) return undefined;
  const id = setTimeout(done, ms);
  return () => clearTimeout(id);
}

/** The inspector took focus when it opened: closing it returns focus to the control that opened it, at once. */
export function openFocus(open: boolean, inspector: Parameters<ReturnType<typeof createFocusReturn>["open"]>[0], getActive: () => FocusTarget | null): (() => void) | undefined {
  if (!open) return undefined;
  const fr = createFocusReturn(getActive);
  fr.open(inspector);
  return () => fr.close();
}

/** Calls `set` with the time every second while `on`; returns the cleanup. */
export function tickWhile(on: boolean, set: (ms: number) => void, now: () => number = Date.now): (() => void) | undefined {
  if (!on) return undefined;
  const id = setInterval(() => set(now()), 1000);
  return () => clearInterval(id);
}
