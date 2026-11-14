import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface CheckboxProps extends Common {
  /** The label is part of the hit area; without one, `ariaLabel` names the box. */
  label?: string;
  checked: boolean;
  disabled?: boolean;
  /** single or group. */
  variant?: string;
  ariaLabel?: string;
  onAction?: (checked: boolean) => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** checkbox: a native checkbox inside its label, so Space toggles it and VoiceOver reads a checkbox. */
export function Checkbox({ label, checked, disabled, variant = "single", ariaLabel, onAction, id, ...o }: CheckboxProps) {
  return (
    <label className={cx("np-check", o.cls, disabled && "is-disabled")} {...base("checkbox", { ...o, variant, state: checked ? "on" : "off" })}>
      <input type="checkbox" id={id} checked={checked} disabled={disabled} aria-label={label ? undefined : ariaLabel} onChange={(e) => onAction?.(e.target.checked)} />
      <span className="np-check__box" aria-hidden="true">
        {checked && <Icon name="check" size={11} />}
      </span>
      {label && <span className="np-check__label">{label}</span>}
    </label>
  );
}
