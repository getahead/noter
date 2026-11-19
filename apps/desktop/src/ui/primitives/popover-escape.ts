import type { KeyboardEvent as ReactKeyboardEvent } from "react";

const closers = new Map<HTMLElement, () => void>();

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** Let inner controls handle Esc first, then dismiss the last painted popover before its sheet or the shell. */
export function dismissPopover(e: KeyboardEvent | ReactKeyboardEvent<HTMLElement>): boolean {
  if (e.key !== "Escape" || e.defaultPrevented || ("nativeEvent" in e ? e.nativeEvent.isComposing : e.isComposing) || !closers.size) return false;
  const top = [...document.querySelectorAll<HTMLElement>(".np-pop")].reverse().find((root) => closers.has(root));
  const close = top && closers.get(top);
  if (!close) return false;
  e.preventDefault();
  e.stopPropagation();
  close();
  return true;
}

/** The document fallback also hears Escape after Tab moved focus outside every popover. */
export function closeOnEscape(onClose: () => void, root: HTMLElement) {
  closers.set(root, onClose);
  document.addEventListener("keydown", dismissPopover);
  return () => {
    closers.delete(root);
    if (!closers.size) document.removeEventListener("keydown", dismissPopover);
  };
}
