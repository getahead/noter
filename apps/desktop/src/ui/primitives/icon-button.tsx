import type { KeyboardEvent } from "react";

import { Icon, type IconName } from "../icons";
import { base, cx, type Common } from "./attrs";
import { press } from "./push-button";

export interface IconButtonProps extends Common {
  icon: IconName;
  /** Required: the VoiceOver name, and the help tag unless `help` says more. */
  label: string;
  size?: "toolbar" | "inline";
  variant?: string;
  state?: string;
  disabled?: boolean;
  on?: boolean;
  pressed?: boolean;
  badge?: string;
  attrs?: Record<string, string | undefined>;
  onAction?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** icon-button: toolbar (on a glass capsule) or inline (22 pt, 24-pt hit area). Space runs it. */
export function IconButton({ icon, label, size = "toolbar", disabled, on, pressed, badge, attrs, onAction, onKeyDown, ...o }: IconButtonProps) {
  const help = o.help || label;
  return (
    <button
      type="button"
      className={cx("np-ibtn", `np-ibtn--${size}`, on && "is-on", o.cls)}
      {...base("icon-button", { ...o, size, state: disabled ? "disabled" : o.state })}
      aria-label={label}
      title={help}
      data-help-tag={help}
      disabled={disabled}
      aria-pressed={pressed}
      {...attrs}
      onClick={() => press({ disabled }, onAction)}
      onKeyDown={onKeyDown}
    >
      <Icon name={icon} size={size === "inline" ? 13 : 15} />
      {badge && <span className="np-ibtn__badge">{badge}</span>}
    </button>
  );
}
