// The sheet catalogue (cpt-noter-component-screen-dialogs): features register their sheets by id and open them
// through the host, which shows one sheet at a time under the window's toolbar.
import type { ComponentType } from "react";

export type SheetProps = Record<string, unknown> & { close: () => void };
export type SheetComponent = ComponentType<SheetProps>;
export interface OpenSheet {
  id: string;
  props: Record<string, unknown>;
}

// @cpt-begin:cpt-noter-state-ui-dialogs-host-sheet:p1:inst-closed-open
// @cpt-begin:cpt-noter-state-ui-dialogs-host-sheet:p1:inst-open-closed
export function createSheets() {
  const registry = new Map<string, SheetComponent>();
  const listeners = new Set<() => void>();
  let open: OpenSheet | null = null;
  const set = (next: OpenSheet | null) => {
    open = next;
    listeners.forEach((l) => l());
  };
  return {
    register: (id: string, component: SheetComponent) =>
      void registry.set(id, component),
    component: (id: string) => registry.get(id),
    current: () => open,
    open: (id: string, props: Record<string, unknown> = {}) =>
      registry.has(id) && set({ id, props }),
    close: () => open && set(null),
    subscribe: (l: () => void) => (
      listeners.add(l),
      () => void listeners.delete(l)
    ),
  };
}
// @cpt-end:cpt-noter-state-ui-dialogs-host-sheet:p1:inst-open-closed
// @cpt-end:cpt-noter-state-ui-dialogs-host-sheet:p1:inst-closed-open

export type Sheets = ReturnType<typeof createSheets>;
