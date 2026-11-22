// popover of the prototype's floating layer (src/js/05-shell.js, positioned as 00-core.js positionFloating does):
// opens under its anchor, Esc or a click outside closes it, focus moves in and returns to the anchor.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { base, zoomFactor } from "./attrs";
import { focusInside } from "./sheet";
import { MENU_FIRST } from "../../app/a11y/focus";
import { closeOnEscape, dismissPopover } from "./popover-escape";

export { closeOnEscape } from "./popover-escape";

type Rect = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };

/** Where a floating surface of `size` goes next to `anchor` inside `view`: below with a 6-pt gap, above when
 *  there is no room below, at least 8 pt from the window edges; centred near the top without an anchor. */
export function placeFloating(anchor: Rect | null, size: Size, view: Size, align: "start" | "end" = "start") {
  if (!anchor) return { left: Math.max(8, (view.width - size.width) / 2), top: 80 };
  const left = Math.min(Math.max(align === "end" ? anchor.right - size.width : anchor.left, 8), Math.max(8, view.width - size.width - 8));
  const below = anchor.bottom + 6;
  const above = anchor.top - size.height - 6;
  return { left, top: below + size.height + 12 > view.height && above > 0 ? above : below };
}

/** The place of the rendered popover `el` next to `anchor` in the window. */
export function measure(el: HTMLElement | null, anchor: HTMLElement | null, align?: "start" | "end") {
  if (!el) return null;
  const zoom = zoomFactor(el);
  const rect = anchor?.getBoundingClientRect();
  const localAnchor = rect && { left: rect.left / zoom, right: rect.right / zoom, top: rect.top / zoom, bottom: rect.bottom / zoom };
  return placeFloating(localAnchor ?? null, { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth / zoom, height: innerHeight / zoom }, align);
}

/** Calls `onClose` on a pointer press outside the popover and its anchor; returns the remover. */
export function closeOnOutside(popover: { current: HTMLElement | null }, anchor: HTMLElement | null, onClose: () => void) {
  const outside = (e: Event) => {
    const t = e.target as Node;
    if (!popover.current?.contains(t) && !anchor?.contains(t)) onClose();
  };
  document.addEventListener("pointerdown", outside);
  return () => document.removeEventListener("pointerdown", outside);
}

export interface PopoverProps {
  /** The popover's name (data-variant), as the prototype's overlay id. */
  variant?: string;
  anchor: HTMLElement | null;
  align?: "start" | "end";
  /** 280 to 380. */
  width?: number;
  /** VoiceOver name of the dialog. */
  label?: string;
  onClose: () => void;
  children?: ReactNode;
}

/** Closing hands focus back to the anchor when it can take it (a span that is no control cannot), else to what had it before. */
export function returnFocus(anchor: { tabIndex: number; focus(): void } | null | undefined, restore: () => void): void {
  const focusable = anchor !== null && anchor !== undefined && anchor.tabIndex >= 0;
  if (!focusable) {
    restore();
    return;
  }
  anchor.focus();
}

/** Focus into an opened popover: a menu's first item before anything else. Roving menu items have tabIndex -1, so the
 *  plain focusable rule skipped them and focus fell on the popover box, where ↑/↓ reach no item (issue 1098). */
export const popoverFocus = (root: HTMLElement | null) => focusInside(root, MENU_FIRST);

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Popover({ variant, anchor, align, width, label, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => setPlace(measure(ref.current, anchor, align)), [anchor, align]);
  // focus moves in once it is placed: a hidden element takes no focus
  const placed = place !== null;
  useEffect(() => {
    if (!placed) return;
    const restore = popoverFocus(ref.current);
    // focus goes back to the anchor: after a click WebKit leaves no focused element to go back to
    return () => returnFocus(anchor, restore);
  }, [placed]); // once per opening
  useEffect(() => closeOnOutside(ref, anchor, onClose), [anchor, onClose]);
  useEffect(() => ref.current ? closeOnEscape(onClose, ref.current) : undefined, [onClose]);
  const pop = (
    <div
      ref={ref}
      className="np-pop"
      {...base("popover", { variant })}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      // .np-pop is hidden until placed, as in the prototype
      style={{ width, ...(place && { position: "fixed", ...place, visibility: "visible" }) }}
      onKeyDown={dismissPopover}
    >
      {children}
    </div>
  );
  const root = zoomedRegionRoot(anchor);
  return root ? createPortal(pop, root) : pop;
}

/** The window root when `anchor` sits in a region Text size zooms (the call window's header and transcript): a popover
 *  there is drawn at the root, so it keeps system size and is placed in the window's coordinates (#1190). Anywhere
 *  else it stays in place, inside its sheet's focus trap. */
export function zoomedRegionRoot(anchor: HTMLElement | null): Element | null {
  const root = anchor?.closest?.(".np-win");
  if (!root) return null;
  for (let e = anchor!.parentElement; e && e !== root; e = e.parentElement) if ((parseFloat(getComputedStyle(e).zoom) || 1) !== 1) return root;
  return null;
}
