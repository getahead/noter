// sheet of the prototype's window overlays (src/js/05-shell.js): a modal dialog on the window, 480 to 640 wide.
// Esc cancels; Return runs the default button (⌘Return in a multi-line field); focus stays inside and goes back
// to where it was when the sheet closes.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { base } from "./attrs";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keys of a modal surface: Esc, Return to the default button, and Tab kept inside. */
export function sheetKey(e: KeyboardEvent<HTMLElement>, onCancel: () => void, onDefault?: () => void) {
  const tag = (e.target as HTMLElement).tagName;
  if (e.key === "Escape") onCancel();
  else if (e.key === "Enter" && onDefault && (tag === "TEXTAREA" ? e.metaKey : tag !== "BUTTON" && tag !== "A")) {
    e.preventDefault();
    onDefault();
  } else if (e.key === "Tab") {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE));
    const edge = e.shiftKey ? items[0] : items[items.length - 1];
    if (edge && e.target === edge) {
      e.preventDefault();
      (e.shiftKey ? items[items.length - 1] : items[0]).focus();
    }
  }
}

/** Focuses the first control of `root` (or root itself); the returned cleanup gives focus back to the element
 *  focused before. */
export function focusInside(root: HTMLElement | null) {
  const before = document.activeElement as HTMLElement | null;
  (root?.querySelector<HTMLElement>(FOCUSABLE) ?? root)?.focus();
  return () => before?.focus?.();
}

export const useFocusInside = (root: { current: HTMLElement | null }) => useEffect(() => focusInside(root.current), [root]);

export interface SheetProps {
  /** VoiceOver name of the dialog. */
  title: string;
  /** 480 to 640; the prototype's default is 520 (stylesheet). */
  width?: number;
  /** The default button's command runs. */
  busy?: boolean;
  onCancel: () => void;
  onDefault?: () => void;
  children?: ReactNode;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Sheet({ title, width, busy, onCancel, onDefault, children }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusInside(ref);
  return (
    // is-new: the slide-in plays once, when React mounts the sheet
    <div className="np-sheet-layer is-new">
      <div
        ref={ref}
        className="np-sheet"
        {...base("sheet", { variant: width ? String(width) : undefined, state: busy ? "busy" : "open" })}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? { width } : undefined}
        onKeyDown={(e) => sheetKey(e, onCancel, onDefault)}
      >
        {children}
      </div>
    </div>
  );
}
