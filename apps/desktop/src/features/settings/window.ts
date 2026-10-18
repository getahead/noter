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
  if (s.hidden) return "HIDDEN_FOR_PRESENTING";
  const found = searchPanes(s.search).kind;
  if (found !== "all") return found === "none" ? "NO_MATCH" : "SEARCH_RESULTS";
  return s.error === null ? "PANE" : "PANE_ERROR";
}
