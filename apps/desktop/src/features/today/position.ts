import type { Bridge } from "../../app/bridge/bridge";

interface Position {
  expanded: ReadonlyMap<string, boolean>;
  all: Set<string>;
  doneOpen?: boolean;
  focused: string | null;
  group?: string;
  /** The one row that is a Tab stop; it moves only when a row itself takes focus, not when a control inside a row does. */
  stop?: { id: string; group?: string };
}
const positions = new WeakMap<Bridge, Position>();
/** Keep disclosures and row position when evidence navigation unmounts Today. */
export function positionOf(bridge: Bridge): Position {
  let position = positions.get(bridge);
  if (!position) {
    position = { expanded: new Map(), all: new Set(), focused: null };
    positions.set(bridge, position);
  }
  return position;
}

/** Reconcile one roving row stop and recover focus when the core moves a completed item. */
export function restorePosition(root: HTMLElement | null, position: Position) {
  if (!root) return;
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-item-id]"));
  const groupOf = (row: HTMLElement) => row.closest<HTMLElement>("[data-today-group]")?.dataset.todayGroup;
  const find = (id: string | undefined, group: string | undefined) => {
    const matches = rows.filter((row) => row.dataset.itemId === id);
    return matches.find((row) => groupOf(row) === group) ?? matches[0];
  };
  const selected = find(position.focused ?? undefined, position.group);
  const stop = (position.stop && find(position.stop.id, position.stop.group)) || selected || rows[0];
  if (stop) position.stop = { id: stop.dataset.itemId!, group: groupOf(stop) };
  rows.forEach((row) => {
    row.tabIndex = row === stop ? 0 : -1;
    row.toggleAttribute("data-return-focus", row === selected);
  });
  const doc = root.ownerDocument;
  if (position.focused && (!doc.activeElement || doc.activeElement === doc.body)) {
    (selected ?? root.querySelector<HTMLElement>('[data-region="TD-R7"] button'))?.focus();
  }
}
