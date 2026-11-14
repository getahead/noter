import type { SettingsPane } from "../../core/bindings";
import { searchPanes } from "./search";

export interface WindowState {
  pane: SettingsPane;
  search: string;
}

export type WindowEvent =
  | { type: "pane"; pane: SettingsPane }
  | { type: "search"; text: string };

export type WindowKind = "PANE" | "SEARCH_RESULTS" | "NO_MATCH" | "PANE_ERROR";

export const INITIAL_WINDOW: WindowState = { pane: "general", search: "" };

export function windowReduce(s: WindowState, e: WindowEvent): WindowState {
  switch (e.type) {
    case "pane":
      return { ...s, pane: e.pane };
    case "search":
      return { ...s, search: e.text };
  }
}

// @cpt-state:cpt-noter-state-ui-settings-window:p1
export function windowKind(s: WindowState, readFailed = false): WindowKind {
  const found = searchPanes(s.search).kind;
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-pane-search
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-search-nomatch
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-nomatch-pane
  if (found !== "all") return found === "none" ? "NO_MATCH" : "SEARCH_RESULTS";
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-nomatch-pane
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-search-nomatch
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-pane-search
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-pane-error
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-error-pane
  return readFailed ? "PANE_ERROR" : "PANE";
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-error-pane
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-pane-error
}

/** The pane-list item that ↑ or ↓ moves focus to; null for any other key or when focus is outside the list. */
export function listStep(key: string, at: number, length: number): number | null {
  const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  return step && at >= 0 ? Math.min(length - 1, Math.max(0, at + step)) : null;
}

/** What a key does in the pane list: focus an item (↓ from the search field enters the list), click the focused one with Return, or nothing. */
export function listKeyAction(key: string, target: string, at: number, length: number): { focus: number } | { click: number } | null {
  if (key === "ArrowDown" && target === "INPUT") return { focus: 0 };
  const to = listStep(key, at, length);
  if (to !== null) return { focus: to };
  return key === "Enter" && at >= 0 ? { click: at } : null;
}
