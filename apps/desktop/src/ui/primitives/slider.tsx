import type { KeyboardEvent } from "react";

import { base, type Common } from "./attrs";

export interface SliderProps extends Common {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** The VoiceOver name of the slider and its paired field. */
  label?: string;
  /** Value text such as "18 percent"; the value and unit by default. */
  valueText?: string;
  unit?: string;
  state?: string;
  disabled?: boolean;
  onAction?: (value: number) => void;
}

/** The value an arrow key moves the slider to: one step, ten with ⇧, within min and max; null for any other key. */
export function sliderKey(key: string, shift: boolean, s: { value: number; min: number; max: number; step: number }): number | null {
  const dir = key === "ArrowRight" || key === "ArrowUp" ? 1 : key === "ArrowLeft" || key === "ArrowDown" ? -1 : 0;
  if (!dir) return null;
  return Math.min(s.max, Math.max(s.min, s.value + dir * s.step * (shift ? 10 : 1)));
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** slider: always paired with a number field for exact input. */
export function Slider({ value, min = 0, max = 100, step = 1, label, valueText, unit, state, disabled, onAction, id, ...o }: SliderProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const next = sliderKey(e.key, e.shiftKey, { value, min, max, step });
    if (next === null) return;
    e.preventDefault();
    onAction?.(next);
  };
  const change = (e: { target: { value: string } }) => onAction?.(Number(e.target.value));
  return (
    <span className="np-slider" {...base("slider", { variant: "with-field", ...o, state: disabled ? "disabled" : state })}>
      <input type="range" id={id} min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} aria-valuetext={valueText || `${value}${unit || ""}`} onChange={change} onKeyDown={onKeyDown} />
      <span className="np-field np-field--number" data-primitive="text-field" data-variant="number">
        <input className="np-field__input np-tnum" type="number" value={value} min={min} max={max} disabled={disabled} aria-label={label} onChange={change} />
      </span>
      {unit && <span className="np-slider__unit">{unit}</span>}
    </span>
  );
}
