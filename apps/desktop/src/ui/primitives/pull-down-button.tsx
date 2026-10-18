import type { KeyboardEvent } from "react";

import type { IconName } from "../icons";
import type { Common } from "./attrs";
import { IconButton } from "./icon-button";
import { PushButton } from "./push-button";

export interface PullDownButtonProps extends Common {
  label: string;
  /** Whether the owner shows its menu now (the menu primitive draws it in the floating layer). */
  open?: boolean;
  /** toolbar (Share, Add Agent, Mute), panel (Not Now) or item-menu (⋯). */
  variant?: string;
  buttonVariant?: "secondary" | "primary" | "quiet";
  size?: "small" | "regular" | "large" | "toolbar" | "inline";
  icon?: IconName;
  /** An icon button (⋯) instead of a labelled button with a chevron. */
  iconOnly?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  /** Opens or closes the owner's menu. */
  onAction?: () => void;
}

/** Space (a native button press) or ↓ opens the menu; ↓ does nothing while it is open. */
export function opensMenu(key: string, open = false): boolean {
  return key === "ArrowDown" && !open;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** pull-down-button: a menu button, as the prototype builds it from a push button or an icon button. */
export function PullDownButton({ label, open = false, variant, buttonVariant = "secondary", size, icon, iconOnly, ariaLabel, disabled, onAction, ...o }: PullDownButtonProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!opensMenu(e.key, open) || disabled) return;
    e.preventDefault();
    onAction?.();
  };
  if (iconOnly)
    return (
      <IconButton
        {...o}
        icon={icon || "ellipsis"}
        label={ariaLabel || label}
        size={size === "toolbar" ? "toolbar" : "inline"}
        disabled={disabled}
        attrs={{ "data-primitive": "pull-down-button", "aria-haspopup": "menu", "aria-expanded": String(open), "data-variant": variant || "item-menu" }}
        onAction={onAction}
        onKeyDown={onKeyDown}
      />
    );
  return (
    <PushButton
      {...o}
      label={label}
      variant={buttonVariant}
      size={size === "small" || size === "large" ? size : "regular"}
      icon={icon}
      chevron
      expanded={open}
      disabled={disabled}
      ariaLabel={ariaLabel}
      attrs={{ "data-primitive": "pull-down-button", "aria-haspopup": "menu", "data-variant": variant || "toolbar" }}
      onAction={onAction}
      onKeyDown={onKeyDown}
    />
  );
}
