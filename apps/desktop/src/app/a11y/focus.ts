// Focus: return to the opener after an overlay, Tab order independent of the macOS keyboard-navigation
// setting (D51), and focused elements kept clear of sticky parts (WCAG 2.4.11).
export type FocusTarget = { focus(): void; isConnected?: boolean; getAttribute?(name: string): string | null };
type FocusState = "IN_PAGE" | "IN_OVERLAY" | "RETURNED";

// WebKit does not focus a button on a mouse click, so document.activeElement is the body when a sheet opens;
// the pressed control is the opener then. A keypress forgets it.
let pressed: FocusTarget | null = null;
export function notePress(target: EventTarget | null) {
  pressed = ((target as Element | null)?.closest?.("button,a[href],summary,[role=button],[tabindex]") as FocusTarget | null) ?? null;
}
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => notePress(e.target), true);
  document.addEventListener("keydown", () => notePress(null), true);
}
/** The element to give focus back to: the focused one, else the control the mouse pressed (used once). */
export function openerOf(doc: Pick<Document, "activeElement" | "body">): FocusTarget | null {
  const opener = peekOpener(doc);
  pressed = null;
  return opener;
}
const peekOpener = (doc: Pick<Document, "activeElement" | "body">) => {
  const active = doc.activeElement as FocusTarget | null;
  return active && active !== (doc.body as unknown) ? active : pressed;
};

/** True when `id` is the focused element or the control the mouse pressed (used once): the Remove button that
 *  started an action, by keyboard or by mouse. */
export const startedFrom = (doc: Pick<Document, "activeElement" | "body">, id: string) => (peekOpener(doc) as { id?: string } | null)?.id === id; // a peek: the confirm sheet that follows still needs the press

/** Move focus into a transient surface and return it to the connected opener on cleanup. */
// @cpt-state:cpt-noter-state-ui-accessibility-l10n-focus-return:p1
export function focusAndReturn(first: FocusTarget | null | undefined, getActive: () => FocusTarget | null): () => void {
  const opener = getActive();
  let state: FocusState = "IN_PAGE";
  // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-page-overlay
  first?.focus();
  state = "IN_OVERLAY";
  // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-page-overlay
  return () => {
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-close
    pressed = null; // a press left over from before the surface opened is not the next opener
    if (state !== "IN_OVERLAY") return;
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-if-close
    // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-overlay-returned
    // @cpt-begin:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus
    // an opener the sheet's own work replaced names the control that took its place (Add… became Replace…), else
    // a control with its own id does (the empty state's Add Mapping… became the table's)
    const successor = opener?.getAttribute?.("data-focus-successor") ?? (opener as { id?: string } | null)?.id;
    const target = opener && opener.isConnected === false && successor ? (typeof document !== "undefined" ? document.getElementById(successor) : null) : opener;
    if (target && target.isConnected !== false) target.focus();
    // @cpt-end:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1:inst-return-focus
    state = "RETURNED";
    // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-overlay-returned
    // @cpt-begin:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-returned-page
    state = "IN_PAGE";
    // @cpt-end:cpt-noter-state-ui-accessibility-l10n-focus-return:p1:inst-returned-page
  };
}

// @cpt-flow:cpt-noter-flow-ui-accessibility-l10n-keyboard:p1
export function focusFirstAvailable(doc: Pick<Document, "getElementById">, ids: readonly string[]): boolean {
  for (const id of ids) {
    const target = doc.getElementById(id);
    if (!target || target.hasAttribute("disabled")) continue;
    target.focus();
    return true;
  }
  return false;
}
/** Gives focus to the first of `ids` that can take it, but only when focus was lost (on the body): the control that
 *  had it closed a sheet or form, was replaced, or was never focused by the mouse. Never takes focus from a control. */
export function focusIfLost(doc: Pick<Document, "activeElement" | "body" | "getElementById">, ids: readonly string[]): boolean {
  const active = doc.activeElement;
  return (!active || active === doc.body) && focusFirstAvailable(doc, ids);
}
// `:disabled` also covers controls inside a disabled fieldset.
const NOT_OFF =
  ':not(:disabled):not([tabindex="-1"]):not([hidden]):not([inert])';
export const FOCUSABLE = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[tabindex]",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
]
  .map((s) => s + NOT_OFF)
  .join(",");

/** The next element in Tab order, wrapping around; with no current one, the first (or last going back). */
export function nextFocusable<T>(
  candidates: T[],
  current: unknown,
  back: boolean,
): T | undefined {
  const i = candidates.indexOf(current as T);
  if (i < 0) return back ? candidates.at(-1) : candidates[0];
  return candidates[
    (i + (back ? -1 : 1) + candidates.length) % candidates.length
  ];
}

/** Rendered and visible: not under [hidden] or [inert], not display: none, not visibility: hidden. */
const shown = (el: Element) =>
  !el.closest("[inert],[hidden]") &&
  el.getClientRects().length > 0 &&
  el.ownerDocument?.defaultView?.getComputedStyle(el).visibility !== "hidden";

const isRadio = (el: HTMLElement): el is HTMLInputElement =>
  (el as HTMLInputElement).type === "radio" && !!(el as HTMLInputElement).name;

/** A radio group is one Tab stop, as natively: its checked radio, else its first. */
function oneStopPerRadioGroup(list: HTMLElement[]): HTMLElement[] {
  const checked = new Set(
    list
      .filter((el) => isRadio(el) && el.checked)
      .map((el) => (el as HTMLInputElement).name),
  );
  const seen = new Set<string>();
  return list.filter((el) => {
    if (!isRadio(el)) return true;
    if (checked.has(el.name) ? !el.checked : seen.has(el.name)) return false;
    seen.add(el.name);
    return true;
  });
}

const focusables = (scope: ParentNode) =>
  oneStopPerRadioGroup(
    [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown),
  );

/** Tab and ⇧Tab move through every control; inside an open sheet focus stays in it. */
export function installTabNavigation(root: Document): () => void {
  const on = (e: KeyboardEvent) => {
    if (
      e.defaultPrevented ||
      e.key !== "Tab" ||
      e.ctrlKey ||
      e.altKey ||
      e.metaKey
    )
      return;
    // The trap is the topmost open sheet; a closed one kept in the DOM does not count.
    const scope =
      [...root.querySelectorAll('[aria-modal="true"]')].filter(shown).at(-1) ??
      root;
    const list = focusables(scope as ParentNode);
    let next = nextFocusable(list, root.activeElement, e.shiftKey);
    if (!next) return;
    e.preventDefault();
    // A control can still refuse focus: move on to the following one rather than stick.
    for (let tries = 0; next && tries < list.length; tries++) {
      next.focus();
      if (root.activeElement === next) return;
      next = nextFocusable(list, next, e.shiftKey);
    }
  };
  root.addEventListener("keydown", on);
  return () => root.removeEventListener("keydown", on);
}

type Box = { top: number; bottom: number };

/** The scrollTop that puts the element between the sticky parts (or the same one when it already is). */
export function unobscuredScrollTop(
  scrollTop: number,
  el: Box,
  container: Box,
  stickyTop: number,
  stickyBottom: number,
): number {
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
  const parts = [...c.querySelectorAll(`[data-sticky="${side}"]`)]
    .map((s) => s.getBoundingClientRect())
    .sort((a, b) => sign * (near(a) - near(b)));
  for (const r of parts)
    if (sign * (near(r) - edge) <= 1 && sign * (far(r) - edge) > 0)
      edge = far(r);
  return sign * (edge - near(box));
}

export function installUnobscure(root: Document): () => void {
  const on = (e: Event) => {
    const el = e.target as Element | null;
    if (!el?.getBoundingClientRect) return;
    let c = el.parentElement;
    while (
      c &&
      !/auto|scroll/.test(root.defaultView!.getComputedStyle(c).overflowY)
    )
      c = c.parentElement;
    if (c)
      c.scrollTop = unobscuredScrollTop(
        c.scrollTop,
        el.getBoundingClientRect(),
        c.getBoundingClientRect(),
        stuckInset(c, "top"),
        stuckInset(c, "bottom"),
      );
  };
  root.addEventListener("focusin", on);
  return () => root.removeEventListener("focusin", on);
}
