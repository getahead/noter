// tooltip (help tag): DESIGN 3.2 asks for a tag after 500 ms of hover or at once on keyboard focus, which
// becomes the control's description. The prototype carries help tags as title/data-help-tag only (README).
import { cloneElement, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactElement, type SyntheticEvent } from "react";
import { base } from "./attrs";
import "./tooltip.css";

export const HELP_TAG_MS = 500;

type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/** When the help tag shows: `show(true)` 500 ms into a hover or at once on keyboard focus, `show(false)` on leave, blur or Esc. */
export function helpTag(show: (on: boolean) => void, timers: Timers = realTimers) {
  let pending: unknown = null;
  const cancel = () => pending !== null && (timers.clearTimeout(pending), (pending = null));
  return {
    hover() {
      cancel();
      pending = timers.setTimeout(() => ((pending = null), show(true)), HELP_TAG_MS);
    },
    focus(keyboard: boolean) {
      if (keyboard) show(true);
    },
    hide() {
      cancel();
      show(false);
    },
  };
}

type Handler<E> = ((e: E) => void) | undefined;
const chain = <E,>(own: Handler<E>, mine: (e: E) => void) => (e: E) => (own?.(e), mine(e));
const focusVisible = (el: Element) => {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
};

type ChildProps = {
  onPointerEnter?: Handler<SyntheticEvent>;
  onPointerLeave?: Handler<SyntheticEvent>;
  onFocus?: Handler<FocusEvent>;
  onBlur?: Handler<FocusEvent>;
  onKeyDown?: Handler<KeyboardEvent>;
};

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** Wraps one control; `text` is its help tag and its accessible description. */
export function Tooltip({ text, children }: { text: string; children: ReactElement<ChildProps> }) {
  const id = useId();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const target = useRef<Element | null>(null);
  const tag = useMemo(() => helpTag((on) => {
    const r = on ? target.current?.getBoundingClientRect() : null;
    setAt(r ? { left: r.left, top: r.bottom + 6 } : null);
  }), []);
  const p = children.props;
  const control = cloneElement(children, {
    "aria-describedby": id,
    "data-help-tag": text,
    onPointerEnter: chain(p.onPointerEnter, (e) => ((target.current = e.currentTarget as Element), tag.hover())),
    onPointerLeave: chain(p.onPointerLeave, () => tag.hide()),
    onFocus: chain(p.onFocus, (e) => ((target.current = e.currentTarget), tag.focus(focusVisible(e.currentTarget)))),
    onBlur: chain(p.onBlur, () => tag.hide()),
    onKeyDown: chain(p.onKeyDown, (e) => e.key === "Escape" && tag.hide()),
  } as ChildProps);
  return (
    <>
      {control}
      <span role="tooltip" className="np-helptag" {...base("tooltip", { id, variant: "one", state: at ? "shown" : undefined })} hidden={!at} style={at ?? undefined}>
        {text}
      </span>
    </>
  );
}
