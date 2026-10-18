import { useId, type ReactNode } from "react";

import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface TextFieldProps extends Common {
  /** single (26 high), multi, secure, number (↑/↓ step) or date. */
  variant?: "single" | "multi" | "secure" | "number" | "date";
  multiline?: boolean;
  value?: string;
  placeholder?: string;
  /** The VoiceOver name; shown above the field with `showLabel`. */
  label?: string;
  showLabel?: boolean;
  ariaLabel?: string;
  invalid?: boolean;
  /** Shown under an invalid field with an icon, and its description. */
  message?: string;
  disabled?: boolean;
  readonly?: boolean;
  mono?: boolean;
  rows?: number;
  min?: number;
  max?: number;
  step?: number;
  lang?: string;
  trailing?: ReactNode;
  /** Typing: the owner keeps the value (bind/live in the prototype). Without it the field keeps its own. */
  onChange?: (value: string) => void;
  /** Return in a single-line field (the prototype's enter option). */
  onEnter?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** text-field: standard editing; text is plain text, never markup. Validation is the owner's, on blur or submit. */
export function TextField({ variant: v, multiline, value, placeholder, label, showLabel, ariaLabel, invalid, message, disabled, readonly, mono, rows = 3, min, max, step, lang, trailing, onChange, onEnter, id, ...o }: TextFieldProps) {
  const variant = v || (multiline ? "multi" : "single");
  const msgId = useId();
  const described = invalid && message ? msgId : undefined;
  const valueProps = onChange ? { value: value ?? "", onChange: (e: { target: { value: string } }) => onChange(e.target.value) } : { defaultValue: value ?? "" };
  const common = {
    id,
    className: cx("np-field__input", mono && "np-mono"),
    placeholder,
    disabled,
    readOnly: readonly,
    "aria-label": ariaLabel || label,
    "aria-invalid": invalid || undefined,
    "aria-describedby": described,
    lang,
    spellCheck: mono ? false : undefined,
    ...valueProps,
  };
  const type = variant === "secure" ? "password" : variant === "number" || variant === "date" ? variant : "text";
  return (
    <span className={cx("np-field", `np-field--${variant}`, invalid && "is-invalid", o.cls)} {...base("text-field", { ...o, variant, state: invalid ? "invalid" : disabled ? "disabled" : readonly ? "read-only" : undefined })}>
      {label && showLabel && <span className="np-field__label">{label}</span>}
      {variant === "multi" ? <textarea rows={rows} {...common} /> : <input type={type} {...common} min={min} max={max} step={step} onKeyDown={(e) => e.key === "Enter" && onEnter?.()} />}
      {trailing}
      {described && (
        <span className="np-field__msg" id={msgId}>
          <Icon name="error" size={12} />
          {message}
        </span>
      )}
    </span>
  );
}
