// Arrow-key movement inside composite primitives (table, source list, menu): DESIGN 3.2 › Primitives
// inventory, Keyboard column. One tab stop per composite; ↑/↓ move between its items, Home/End to the ends.
import type { KeyboardEvent } from "react";

/** The index `key` moves to among `count` items from `current` (-1 when focus is outside them); null for other keys. */
export function nextIndex(key: string, current: number, count: number, wrap = true): number | null {
  if (count === 0) return null;
  const last = count - 1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return last;
    case "ArrowDown":
      if (current < 0) return 0;
      return current < last ? current + 1 : wrap ? 0 : last;
    case "ArrowUp":
      if (current < 0) return last;
      return current > 0 ? current - 1 : wrap ? last : 0;
    default:
      return null;
  }
}

// @cpt-flow:cpt-noter-flow-ui-primitives-operate-control:p1
/** Moves focus to the next item matching `selector` inside the composite; true when the key was a list key. */
export function moveFocus(e: KeyboardEvent<HTMLElement>, selector: string, wrap = true): boolean {
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(selector));
  const current = items.findIndex((el) => el === e.target || el.contains(e.target as Node));
  const next = nextIndex(e.key, current, items.length, wrap);
  if (next === null) return false;
  e.preventDefault();
  items[next].focus();
  return true;
}

/** Return or Space: the keys that run a focused control that is not a native button. */
export const activates = (e: { key: string }) => e.key === "Enter" || e.key === " ";
