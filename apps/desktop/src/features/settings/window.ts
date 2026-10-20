import type { SettingsPane } from "../../core/bindings";
import { searchPanes } from "./search";

export interface WindowState {
  pane: SettingsPane;
  search: string;
  /** A pane-level error (ST-R3), such as **Keychain is locked**. */
  error: string | null;
  hidden: boolean;
}

export type WindowEvent =
  | { type: "pane"; pane: SettingsPane }
  | { type: "search"; text: string }
  | { type: "error"; message: string }
  | { type: "fixed" }
  | { type: "hidden"; hidden: boolean };

export type WindowKind = "PANE" | "SEARCH_RESULTS" | "NO_MATCH" | "PANE_ERROR" | "HIDDEN_FOR_PRESENTING";

export const INITIAL_WINDOW: WindowState = { pane: "general", search: "", error: null, hidden: false };

export function windowReduce(s: WindowState, e: WindowEvent): WindowState {
  switch (e.type) {
    case "pane":
      return { ...s, pane: e.pane };
    case "search":
      return { ...s, search: e.text };
    case "error":
      return { ...s, error: e.message };
    case "fixed":
      return { ...s, error: null };
    case "hidden":
      return { ...s, hidden: e.hidden };
  }
}

// The state is derived from what the window holds, so hiding for presenting "comes back as it was".
// @cpt-state:cpt-noter-state-ui-settings-window:p1
export function windowKind(s: WindowState): WindowKind {
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-pane-hidden
  // @cpt-begin:cpt-noter-state-ui-settings-window:p1:inst-hidden-pane
  if (s.hidden) return "HIDDEN_FOR_PRESENTING";
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-hidden-pane
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-pane-hidden
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
  return s.error === null ? "PANE" : "PANE_ERROR";
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-error-pane
  // @cpt-end:cpt-noter-state-ui-settings-window:p1:inst-pane-error
}

/** The pane-list item that ↑ or ↓ moves focus to; null for any other key or when focus is outside the list. */
export function listStep(key: string, at: number, length: number): number | null {
  const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  return step && at >= 0 ? Math.min(length - 1, Math.max(0, at + step)) : null;
}
