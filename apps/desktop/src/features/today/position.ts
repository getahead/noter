import type { Bridge } from "../../app/bridge/bridge";

interface Position {
  expanded: ReadonlyMap<string, boolean>;
  all: Set<string>;
  doneOpen?: boolean;
  focused: string | null;
  group?: string;
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
  const matches = rows.filter((row) => row.dataset.itemId === position.focused);
  const selected = matches.find((row) => row.closest<HTMLElement>("[data-today-group]")?.dataset.todayGroup === position.group) ?? matches[0];
  rows.forEach((row) => {
    row.tabIndex = row === (selected ?? rows[0]) ? 0 : -1;
    row.toggleAttribute("data-return-focus", row === selected);
  });
  const doc = root.ownerDocument;
  if (position.focused && (!doc.activeElement || doc.activeElement === doc.body)) {
    (selected ?? root.querySelector<HTMLElement>('[data-region="TD-R7"] button'))?.focus();
  }
}
