// The seam by which a feature opens the trailing inspector (MW-R4) on whatever page is showing: the Item inspector
// (320, 2.17) from a row, the Handoff drawer (400, 2.21) from a button. It replaces the page's own inspector until it
// is closed (× or Esc), the route changes, or another override takes its place. A module store like the undo strip's.
// Override contents handle Esc while focused; the shell does not route its global Escape action to this store.
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { MsgKey } from "../../i18n/en";
import type { PageDef } from "./pages";

export interface InspectorOverride {
  width: 320 | 400;
  label: MsgKey;
  render: (bridge: Bridge) => ReactNode;
  /** Runs on explicit close to restore focus, but not when navigating away from the opener's page. */
  onClose?: () => void;
}

let current: InspectorOverride | null = null;
const listeners = new Set<() => void>();
const set = (o: InspectorOverride | null) => ((current = o), listeners.forEach((l) => l()));

// @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-get
export const openInspector = (o: InspectorOverride) => set(o);
// @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-get

export function closeInspector(reason?: "route") {
  const was = current;
  set(null);
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-return
  if (reason !== "route") was?.onClose?.(); // the opener puts focus back on its row
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-return
}

export const inspectorOverride = () => current;
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** The open override as the shell's inspector definition, or null. */
export function useInspectorOverride(): NonNullable<PageDef["inspector"]> | null {
  const o = useSyncExternalStore(subscribe, inspectorOverride, inspectorOverride);
  return useMemo(() => o && { width: o.width, label: o.label, render: (_route, bridge) => o.render(bridge) }, [o]);
}
