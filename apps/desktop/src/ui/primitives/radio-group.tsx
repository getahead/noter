import { base, cx, type Common } from "./attrs";

export interface RadioOption {
  value: string;
  label: string;
  /** A one-line consequence under the label. */
  note?: string;
  disabled?: boolean;
}

export interface RadioGroupProps extends Common {
  name: string;
  options: RadioOption[];
  value: string;
  label?: string;
  variant?: string;
  onAction?: (value: string) => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** radio-group: native radios sharing a name, so ↑/↓ moves and selects and VoiceOver reads a radio group. */
export function RadioGroup({ name, options, value, label, variant = "vertical", onAction, ...o }: RadioGroupProps) {
  return (
    <div className={cx("np-radios", o.cls)} role="radiogroup" {...base("radio-group", { ...o, variant })} aria-label={label}>
      {options.map((op) => (
        <label key={op.value} className="np-radio">
          <input type="radio" name={name} value={op.value} checked={op.value === value} disabled={op.disabled} onChange={() => onAction?.(op.value)} />
          <span className="np-radio__dot" aria-hidden="true" />
          <span>
            <span className="np-radio__label">{op.label}</span>
            {op.note && <span className="np-radio__note">{op.note}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
