export type SectionKey = "today" | "ask" | "library" | "people" | "topics" | "activity" | "agents" | "performance";

/** A page in a section; `key` is opaque to the history (`root`, `call:<id>`, …). */
export interface Route {
  section: SectionKey;
  key: string;
}

export interface History {
  entries: readonly Route[];
  index: number;
  /** Each section's last location. */
  last: Partial<Record<SectionKey, Route>>;
  inspectorOpen: boolean;
}

export type HistoryMove =
  | { type: "section"; section: SectionKey }
  /** `keepInspector`: an inspector opened for an item on the same page stays open. */
  | { type: "push" | "replace"; route: Route; keepInspector?: boolean; inspector?: boolean }
  | { type: "back" | "forward" };

const ROOT = (section: SectionKey): Route => ({ section, key: "root" });
const same = (a: Route, b: Route) => a.section === b.section && a.key === b.key;

export const INITIAL_HISTORY: History = { entries: [ROOT("today")], index: 0, last: { today: ROOT("today") }, inspectorOpen: false };

// @cpt-algo:cpt-noter-algo-ui-main-window-shell-history:p1
export function historyMove(h: History, m: HistoryMove): { history: History; route: Route } {
  const current = h.entries[h.index]!;
  let { entries, index } = h;
  let route = current;
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-match-move
  switch (m.type) {
    // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-section
    case "section": {
      route = h.last[m.section] ?? ROOT(m.section);
      // shortcut: a section that is already showing is not pushed twice, so ⌘3 pressed twice adds no entry
      if (!same(route, current)) {
        entries = [...entries.slice(0, index + 1), route];
        index += 1;
      }
      break;
    }
    // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-section
    // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-push
    case "push":
      route = m.route;
      entries = [...entries.slice(0, index + 1), route];
      index += 1;
      break;
    // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-push
    // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-replace
    case "replace":
      route = m.route;
      entries = entries.map((e, i) => (i === index ? route : e));
      break;
    // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-replace
    // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-back
    case "back":
    case "forward": {
      const next = index + (m.type === "back" ? -1 : 1);
      if (next < 0 || next >= entries.length) return { history: h, route: current };
      index = next;
      route = entries[index]!;
    }
    // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-case-back
  }
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-match-move
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-close-inspector
  const keeps = (m.type === "push" || m.type === "replace") && m.keepInspector === true;
  const opens = (m.type === "push" || m.type === "replace") && m.inspector === true;
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-close-inspector
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-remember-section
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-history:p1:inst-return-history
  const history: History = { entries, index, last: { ...h.last, [route.section]: route }, inspectorOpen: keeps ? h.inspectorOpen || opens : false };
  return { history, route };
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-return-history
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-history:p1:inst-remember-section
}
