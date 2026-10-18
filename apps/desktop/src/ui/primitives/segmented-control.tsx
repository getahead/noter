import { useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { Icon, type IconName } from "../icons";
import { base, cx, type Common } from "./attrs";
import { PopupButton } from "./popup-button";

export type Segment = string | { value: string; label: string; icon?: IconName; count?: number; disabled?: boolean };
const segValue = (s: Segment) => (typeof s === "string" ? s : s.value);
const segLabel = (s: Segment) => (typeof s === "string" ? s : s.label);

export interface SegmentedControlProps extends Common {
  /** At most 5 segments. */
  items: Segment[];
  value: string;
  /** view: a view switch (tab list; selection follows focus); option: a form choice (radio group). */
  variant?: "view" | "option";
  size?: string;
  state?: string;
  label?: string;
  onAction?: (value: string) => void;
}

/** The segment ←/→ moves to from `from`, skipping disabled ones and wrapping; null for any other key. */
export function segmentKey(key: string, disabled: boolean[], from: number): number | null {
  const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
  if (!step) return null;
  for (let n = 1, i = from; n <= disabled.length; n++) {
    i = (i + step + disabled.length) % disabled.length;
    if (!disabled[i]) return i;
  }
  return null;
}

// @cpt-algo:cpt-noter-algo-ui-primitives-fit-labels:p1
/** Whether the segments laid out at their natural width fit the width their container gives them. */
export function labelsFit(natural: number, available: number): boolean {
  return natural <= available;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** segmented-control: a capsule track of up to five segments; a pop-up with the same options when the labels do not fit. */
export function SegmentedControl({ items, value, variant = "view", label, onAction, ...o }: SegmentedControlProps) {
  const root = useRef<HTMLElement>(null);
  const natural = useRef(0);
  const measuredFor = useRef("");
  const [collapsed, setCollapsed] = useState(false);
  const labels = items.map(segLabel).join("\n");

  useLayoutEffect(() => {
    const el = root.current;
    const parent = el?.parentElement;
    if (!el || !parent || typeof ResizeObserver === "undefined") return;
    // @cpt-begin:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-if-seg
    if (!collapsed) natural.current = el.offsetWidth;
    else if (measuredFor.current !== labels) {
      setCollapsed(false); // new labels: lay them out as segments once to measure them
      return;
    }
    measuredFor.current = labels;
    const fit = () => setCollapsed(!labelsFit(natural.current, parent.clientWidth));
    // @cpt-end:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-if-seg
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(parent);
    return () => watch.disconnect();
  }, [collapsed, labels]);

  // @cpt-begin:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-seg-popup
  if (collapsed) return <PopupButton ref={root as Ref<HTMLSpanElement>} options={items.map((s) => ({ value: segValue(s), label: segLabel(s), disabled: typeof s !== "string" && s.disabled }))} value={value} variant={variant === "view" ? "toolbar" : "form"} label={label} onAction={onAction} {...o} />;
  // @cpt-end:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-seg-popup

  // @cpt-begin:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-return-layout
  return <SegmentTrack ref={root as Ref<HTMLDivElement>} items={items} value={value} variant={variant} label={label} onAction={onAction} {...o} />;
  // @cpt-end:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-return-layout
}

/** The capsule track itself: segments as tabs or radios, ←/→ between them (roving focus). */
export function SegmentTrack({ items, value, variant = "view", label, onAction, ref, ...o }: SegmentedControlProps & { ref?: Ref<HTMLDivElement> }) {
  const view = variant === "view";
  const disabled = items.map((s) => typeof s !== "string" && !!s.disabled);
  const focusable = Math.max(0, items.findIndex((s) => segValue(s) === value));
  // ←/→ moves between segments; a view switch selects as focus moves, an option waits for Space
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
    const next = segmentKey(e.key, disabled, buttons.indexOf(e.target as HTMLButtonElement));
    if (next === null) return;
    e.preventDefault();
    buttons[next].focus();
    if (view) onAction?.(segValue(items[next]));
  };
  return (
    <div ref={ref} className={cx("np-seg", o.cls)} role={view ? "tablist" : "radiogroup"} {...base("segmented-control", { ...o, variant })} aria-label={label} onKeyDown={onKeyDown}>
      {items.map((s, i) => {
        const sel = segValue(s) === value;
        return (
          <button
            key={segValue(s)}
            type="button"
            className={cx("np-seg__item", sel && "is-sel")}
            role={view ? "tab" : "radio"}
            aria-selected={view ? sel : undefined}
            aria-checked={view ? undefined : sel}
            tabIndex={i === focusable ? 0 : -1}
            disabled={disabled[i]}
            onClick={() => onAction?.(segValue(s))}
          >
            {typeof s !== "string" && s.icon && <Icon name={s.icon} size={13} />}
            {segLabel(s)}
            {typeof s !== "string" && s.count != null && (
              <>
                {" "}
                <span className="np-seg__count">{s.count}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
