// The native Edit menu's Fix Term…: it is enabled while confirmed words of a stored line are selected.
import type { SegmentView } from "../../core/bindings";
import { selectedFixTerm } from "./segment-row";

/** Calls `setEnabled` when the selection gains or loses confirmed words; returns the stop, which disables the item. */
export function watchFixTermMenu(
  doc: Pick<Document, "addEventListener" | "removeEventListener">,
  selection: () => Selection | null,
  segments: () => readonly SegmentView[],
  setEnabled: (enabled: boolean) => void,
): () => void {
  let on = false;
  const set = (enabled: boolean) => {
    if (enabled !== on) setEnabled((on = enabled));
  };
  const follow = () => set(!!selectedFixTerm(selection(), segments()));
  doc.addEventListener("selectionchange", follow);
  return () => {
    doc.removeEventListener("selectionchange", follow);
    set(false);
  };
}

/** The menu item was chosen (`chosen` counts the choices): opens the term fix on what `pick` finds selected, once per choice. */
export function followFixTermChoice<T>(handled: { current: number }, chosen: number, pick: () => T | null, open: (picked: T) => void): void {
  if (chosen === handled.current) return;
  handled.current = chosen;
  const picked = pick();
  if (picked) open(picked);
}
