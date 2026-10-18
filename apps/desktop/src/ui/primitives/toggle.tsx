import { base, cx, type Common } from "./attrs";

export interface ToggleProps extends Common {
  label?: string;
  on: boolean;
  /** regular 34 × 20, small (rows) 28 × 16. */
  size?: "regular" | "small";
  /** The label after the switch instead of before it. */
  labelAfter?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onAction?: (on: boolean) => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** toggle: a switch for settings that apply at once; Space flips it. */
export function Toggle({ label, on, size = "regular", labelAfter, disabled, ariaLabel, onAction, id, ...o }: ToggleProps) {
  const text = label && <span className="np-toggle__label">{label}</span>;
  return (
    <label className={cx("np-toggle", `np-toggle--${size}`, o.cls, disabled && "is-disabled")} {...base("toggle", { ...o, size, state: on ? "on" : "off" })}>
      {!labelAfter && text}
      <input type="checkbox" role="switch" id={id} checked={on} disabled={disabled} aria-label={label ? undefined : ariaLabel} onChange={(e) => onAction?.(e.target.checked)} />
      <span className="np-toggle__track" aria-hidden="true">
        <span className="np-toggle__thumb" />
      </span>
      {labelAfter && text}
    </label>
  );
}
