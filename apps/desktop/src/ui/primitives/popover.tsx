// popover of the prototype's floating layer (src/js/05-shell.js, positioned as 00-core.js positionFloating does):
// opens under its anchor, Esc or a click outside closes it, focus moves in and returns to the anchor.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { base } from "./attrs";
import { useFocusInside } from "./sheet";

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
  return el && placeFloating(anchor?.getBoundingClientRect() ?? null, { width: el.offsetWidth, height: el.offsetHeight }, { width: innerWidth, height: innerHeight }, align);
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

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Popover({ variant, anchor, align, width, label, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useFocusInside(ref);
  useLayoutEffect(() => setPlace(measure(ref.current, anchor, align)), [anchor, align]);
  useEffect(() => closeOnOutside(ref, anchor, onClose), [anchor, onClose]);
  return (
    <div
      ref={ref}
      className="np-pop"
      {...base("popover", { variant })}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      // .np-pop is hidden until placed, as in the prototype
      style={{ width, ...(place && { position: "fixed", ...place, visibility: "visible" }) }}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
    >
      {children}
    </div>
  );
}
