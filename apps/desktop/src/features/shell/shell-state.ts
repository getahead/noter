import { INITIAL_HISTORY, historyMove, type History, type HistoryMove, type Route } from "./history";

/** Zoom steps in percent: ⌘0 is 100, ⌘+ and ⌘− move one step, up to 200 % (WCAG 1.4.4). */
export const ZOOM_STEPS = [100, 125, 150, 175, 200] as const;

/** The sidebar's width in pt: 220 by default, resized at the split divider between 180 and 320. */
export const SIDEBAR = { min: 180, max: 320, initial: 220 } as const;

export interface ShellState {
  history: History;
  /** The user's choice (⌃⌘S) while the sidebar is docked. */
  sidebar: boolean;
  /** The collapsed sidebar is open as an overlay. */
  overlayOpen: boolean;
  /** Percent; 100 is actual size. */
  zoom: number;
  sidebarWidth: number;
}

export type ShellEvent =
  | { type: "move"; move: HistoryMove }
  | { type: "toggle-sidebar"; overlay: boolean }
  | { type: "toggle-inspector" }
  | { type: "close-inspector" }
  | { type: "close-overlay" }
  | { type: "resize-sidebar"; width: number }
  | { type: "zoom"; to: "in" | "out" | "reset" };

export const INITIAL_SHELL: ShellState = { history: INITIAL_HISTORY, sidebar: true, overlayOpen: false, zoom: 100, sidebarWidth: SIDEBAR.initial };

export const currentRoute = (h: History): Route => h.entries[h.index]!;

// @cpt-flow:cpt-noter-flow-ui-main-window-shell-navigate:p1
export function shellReduce(s: ShellState, e: ShellEvent): ShellState {
  switch (e.type) {
    case "move": {
      // @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-history
      const { history } = historyMove(s.history, e.move);
      // a section chosen in the overlay sidebar closes it
      // choosing a page closes the overlay sidebar
      return { ...s, history, overlayOpen: false };
      // @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-history
    }
    case "toggle-sidebar":
      return e.overlay ? { ...s, overlayOpen: !s.overlayOpen } : { ...s, sidebar: !s.sidebar };
    case "toggle-inspector":
      return { ...s, history: { ...s.history, inspectorOpen: !s.history.inspectorOpen } };
    case "close-inspector":
      return s.history.inspectorOpen ? { ...s, history: { ...s.history, inspectorOpen: false } } : s;
    case "close-overlay":
      return s.overlayOpen ? { ...s, overlayOpen: false } : s;
    case "resize-sidebar":
      return { ...s, sidebarWidth: Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, e.width)) };
    case "zoom": {
      const i = ZOOM_STEPS.indexOf(s.zoom as (typeof ZOOM_STEPS)[number]);
      const to = e.to === "reset" ? 0 : Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + (e.to === "in" ? 1 : -1)));
      return { ...s, zoom: ZOOM_STEPS[to]! };
    }
  }
}

/** The window fills the WebView at any zoom: CSS zoom scales every length, so the box is the viewport divided by it. */
export function zoomStyle(percent: number): { zoom: number | undefined; width: string; height: string } {
  const z = percent / 100;
  return { zoom: percent === 100 ? undefined : z, width: `calc(100vw / ${z})`, height: `calc(100vh / ${z})` };
}
