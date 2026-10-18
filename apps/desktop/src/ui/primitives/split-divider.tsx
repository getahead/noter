// split-divider of the prototype's src/js/02-primitives.js (decorative there). When the owner passes onChange
// it is DESIGN's adjustable separator: ←/→ resize while focused, dragging resizes, a double-click collapses
// the leading pane.
import { useRef, useState } from "react";
import { base } from "./attrs";
import "./split-divider.css";

type Range = { min: number; max: number; step: number };
const clamp = (v: number, { min, max }: Range) => Math.min(max, Math.max(min, v));

/** The width a key gives the leading pane, or null for other keys. */
export function splitKey(key: string, value: number, range: Range): number | null {
  const next = { ArrowLeft: value - range.step, ArrowRight: value + range.step, Home: range.min, End: range.max }[key];
  return next === undefined ? null : clamp(next, range);
}

export interface SplitDividerProps {
  /** Width of the leading pane in pt. */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  onChange?: (value: number) => void;
  onCollapse?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function SplitDivider({ value = 0, min = 0, max = 10000, step = 10, label, onChange, onCollapse }: SplitDividerProps) {
  const drag = useRef<{ x: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const range = { min, max, step };
  const props = base("split-divider", { variant: "vertical", state: dragging ? "dragging" : undefined });
  if (!onChange) return <div className="np-split" role="separator" aria-orientation="vertical" {...props} />;
  return (
    <div
      className="np-split"
      role="separator"
      aria-orientation="vertical"
      {...props}
      tabIndex={0}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={label}
      onKeyDown={(e) => {
        const next = splitKey(e.key, value, range);
        if (next !== null) (e.preventDefault(), onChange(next));
      }}
      onDoubleClick={onCollapse}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, value };
        setDragging(true);
      }}
      onPointerMove={(e) => drag.current && onChange(clamp(drag.current.value + e.clientX - drag.current.x, range))}
      onPointerUp={() => ((drag.current = null), setDragging(false))}
      onPointerCancel={() => ((drag.current = null), setDragging(false))}
    />
  );
}
