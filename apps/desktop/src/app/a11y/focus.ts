// Focus: return to the opener after an overlay, Tab order independent of the macOS keyboard-navigation
// setting (D51), and focused elements kept clear of sticky parts (WCAG 2.4.11).
import { useEffect, useRef, type RefObject } from "react";

export type FocusTarget = { focus(): void; isConnected?: boolean };
type FocusState = "IN_PAGE" | "IN_OVERLAY" | "RETURNED";

// @cpt-state:cpt-noter-state-ui-accessibility-l10n-focus-return:p1
export function createFocusReturn(getActive: () => FocusTarget | null) {
  let state: FocusState = "IN_PAGE";
  let opener: FocusTarget | null = null;
  return {
    state: () => state,
    open(first?: FocusTarget) {
      // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-page-overlay
      opener = getActive();
      first?.focus();
      state = "IN_OVERLAY";
      // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-page-overlay
    },
    close() {
      if (state !== "IN_OVERLAY") return;
      // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-overlay-returned
      // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-close
      // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus
      if (opener?.isConnected) opener.focus();
      // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus
      // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-close
      state = "RETURNED";
      // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-overlay-returned
    },
    moveOn() {
      // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-returned-page
      if (state === "RETURNED") state = "IN_PAGE";
      // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-returned-page
    },
  };
}

const NOT_OFF = ':not([disabled]):not([tabindex="-1"]):not([hidden]):not([inert])';
export const FOCUSABLE = ["a[href]", "button", "input", "select", "textarea", "[tabindex]", "summary", "[contenteditable]"].map((s) => s + NOT_OFF).join(",");

/** The next element in Tab order, wrapping around; with no current one, the first (or last going back). */
export function nextFocusable<T>(candidates: T[], current: unknown, back: boolean): T | undefined {
  const i = candidates.indexOf(current as T);
  if (i < 0) return back ? candidates.at(-1) : candidates[0];
  return candidates[(i + (back ? -1 : 1) + candidates.length) % candidates.length];
}

const focusables = (scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[inert],[hidden]") && el.getClientRects().length > 0);

/** Tab and ⇧Tab move through every control; inside an open sheet focus stays in it. */
export function installTabNavigation(root: Document): () => void {
  const on = (e: KeyboardEvent) => {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
    const scope = [...root.querySelectorAll('[aria-modal="true"]')].at(-1) ?? root;
    const next = nextFocusable(focusables(scope as ParentNode), root.activeElement, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    next.focus();
  };
  root.addEventListener("keydown", on);
  return () => root.removeEventListener("keydown", on);
}

type Box = { top: number; bottom: number };

/** The scrollTop that puts the element between the sticky parts (or the same one when it already is). */
export function unobscuredScrollTop(scrollTop: number, el: Box, container: Box, stickyTop: number, stickyBottom: number): number {
  // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-unobscure
  const top = container.top + stickyTop;
  const bottom = container.bottom - stickyBottom;
  if (el.top < top) return scrollTop - (top - el.top);
  if (el.bottom > bottom) return scrollTop + (el.bottom - bottom);
  return scrollTop;
  // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-unobscure
}

/** How far the parts stuck to one edge of the container reach in (group headers further down are not stuck yet). */
function stuckInset(c: Element, side: "top" | "bottom"): number {
  const box = c.getBoundingClientRect();
  const sign = side === "top" ? 1 : -1;
  const near = (r: Box) => (side === "top" ? r.top : r.bottom);
  const far = (r: Box) => (side === "top" ? r.bottom : r.top);
  let edge = near(box);
  const parts = [...c.querySelectorAll(`[data-sticky="${side}"]`)].map((s) => s.getBoundingClientRect()).sort((a, b) => sign * (near(a) - near(b)));
  for (const r of parts) if (sign * (near(r) - edge) <= 1 && sign * (far(r) - edge) > 0) edge = far(r);
  return sign * (edge - near(box));
}

export function installUnobscure(root: Document): () => void {
  const on = (e: Event) => {
    const el = e.target as Element | null;
    if (!el?.getBoundingClientRect) return;
    let c = el.parentElement;
    while (c && !/auto|scroll/.test(root.defaultView!.getComputedStyle(c).overflowY)) c = c.parentElement;
    if (c) c.scrollTop = unobscuredScrollTop(c.scrollTop, el.getBoundingClientRect(), c.getBoundingClientRect(), stuckInset(c, "top"), stuckInset(c, "bottom"));
  };
  root.addEventListener("focusin", on);
  return () => root.removeEventListener("focusin", on);
}

/** Open overlays, innermost last: only the topmost one closes on Esc or a press outside it. */
const overlays: object[] = [];

/** While `open`: focus the overlay's first control; Esc or a press outside calls `onClose`; closing returns focus to the opener. */
export function useFocusReturn(open: boolean, overlayRef: RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const me = {};
    overlays.push(me);
    const fr = createFocusReturn(() => document.activeElement as HTMLElement | null);
    fr.open(overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? undefined);
    const top = () => overlays.at(-1) === me;
    const key = (e: KeyboardEvent) => top() && e.key === "Escape" && close.current();
    const press = (e: PointerEvent) => top() && !overlayRef.current?.contains(e.target as Node) && close.current();
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", press);
    return () => {
      overlays.splice(overlays.indexOf(me), 1);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", press);
      // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus-done
      fr.close();
      // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus-done
    };
  }, [open, overlayRef]);
}
