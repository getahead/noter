import type { Ref } from "react";

import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export type Choice = string | { value: string; label: string; disabled?: boolean };
export const choiceValue = (c: Choice) => (typeof c === "string" ? c : c.value);
export const choiceLabel = (c: Choice) => (typeof c === "string" ? c : c.label);

export interface PopupButtonProps extends Common {
  options: Choice[];
  value: string;
  /** form (24 high), toolbar (on glass) or inline (borderless, in table cells). */
  variant?: "form" | "toolbar" | "inline";
  /** default, open, focus, disabled or mixed (Anna +1), set by the owner. */
  state?: string;
  /** The VoiceOver name; the control reads it with its current value. */
  label?: string;
  disabled?: boolean;
  onAction?: (value: string) => void;
  /** The root element, for an owner that measures the layout (the segmented control's fallback). */
  ref?: Ref<HTMLSpanElement>;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** popup-button: a native select, so Space or ↓ opens it, type-ahead works and Return chooses. */
export function PopupButton({ options, value, variant = "form", label, disabled, onAction, id, ref, ...o }: PopupButtonProps) {
  return (
    <span ref={ref} className={cx("np-popup", `np-popup--${variant}`, o.cls)} {...base("popup-button", { ...o, variant })}>
      <select id={id} aria-label={label} disabled={disabled} value={value} onChange={(e) => onAction?.(e.target.value)}>
        {options.map((c) => (
          <option key={choiceValue(c)} value={choiceValue(c)} disabled={typeof c !== "string" && c.disabled}>
            {choiceLabel(c)}
          </option>
        ))}
      </select>
      <Icon name="updown" size={11} cls="np-popup__chev" />
    </span>
  );
}
