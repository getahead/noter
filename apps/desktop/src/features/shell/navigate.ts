// The seam by which a page moves the main window to a route the core has no `NavTarget` for: Search results from
// **Search by Keyword**, a new question from **Ask Instead**, a topic thread or a Person page from a chip. Routes the
// core owns (a Call page, Settings) still go through `window_navigate`. A module seam like `inspector-override.ts`.
import type { Route } from "./history";
import type { ShellEvent } from "./shell-state";

let sink: ((route: Route, replace: boolean) => void) | null = null;

// @cpt-begin:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-user-nav
/** Pushes `route` on the main window's history (Back returns to the page that asked), or with `replace` takes the current entry's place; nothing outside a main window. */
export const navigate = (route: Route, replace = false) => sink?.(route, replace);
// @cpt-end:cpt-noter-flow-ui-main-window-shell-navigate:p1:inst-user-nav

/** The main window's effect: its history takes the routes pages ask for, until the returned release runs. */
export function navigateEffect(dispatch: (e: ShellEvent) => void): () => void {
  const mine = (route: Route, replace: boolean) => dispatch({ type: "move", move: { type: replace ? "replace" : "push", route } });
  sink = mine;
  return () => void (sink === mine && (sink = null));
}
