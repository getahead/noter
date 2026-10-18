import type { KeyboardEvent, MouseEvent } from "react";

import { Icon, type IconName } from "../icons";
import { base, cx, type Common } from "./attrs";
import { KeyCap } from "./key-cap";

export interface PushButtonProps extends Common {
  label: string;
  variant?: "secondary" | "primary" | "quiet" | "destructive";
  size?: "small" | "regular" | "large";
  icon?: IconName;
  /** Key-cap shown after the label, such as ⌘↩. */
  kbd?: string;
  /** The owner's command for this button is running: a spinner replaces the icon, the label stays. */
  loading?: boolean;
  /** With `help`, the reason stays as the help tag and description. */
  disabled?: boolean;
  /** A visual state the owner pins (`hover`, `pressed`, `focus`), as the prototype's state option. */
  state?: string;
  /** The region's default button (Return): submits its form. */
  submit?: boolean;
  /** aria-keyshortcuts, such as "Meta+Enter". */
  shortcut?: string;
  ariaLabel?: string;
  expanded?: boolean;
  chevron?: boolean;
  /** Inline status on the label (Copied, Saved): shown with a check in place of the label while the owner sets it. */
  flash?: string;
  /** Extra root attributes, as the prototype's attrs option (the pull-down button sets its own data-primitive). */
  attrs?: Record<string, string | undefined>;
  onAction?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

// @cpt-flow:cpt-noter-flow-ui-primitives-operate-control:p1
/** A press runs the owner's handler, unless the control is disabled or busy. Primitives call no core command. */
export function press(o: { disabled?: boolean; loading?: boolean }, handler?: () => void): void {
  // @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-if-disabled
  if (o.disabled || o.loading) {
    // @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-return-noop
    return;
    // @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-return-noop
  }
  // @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-if-disabled
  // @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-call-handler
  handler?.();
  // @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-call-handler
}

// @cpt-state:cpt-noter-state-ui-primitives-push-button:p1
/** data-state of a push button: LOADING and DISABLED come from the owner; hover, pressed and focus from the pointer and keyboard (CSS). */
export function buttonState(o: { loading?: boolean; disabled?: boolean; state?: string }): string | undefined {
  // @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-pressed-loading
  // @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-loading-default
  if (o.loading) return "loading";
  // @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-loading-default
  // @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-pressed-loading
  // @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-default-disabled
  // @cpt-begin:cpt-noter-state-ui-primitives-push-button:p1:inst-disabled-default
  if (o.disabled) return "disabled";
  // @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-disabled-default
  // @cpt-end:cpt-noter-state-ui-primitives-push-button:p1:inst-default-disabled
  return o.state;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
// @cpt-dod:cpt-noter-dod-ui-primitives-text-only:p1
/** push-button: Space or Return runs it; the label is plain text and never truncates. */
export function PushButton({ label, variant = "secondary", size = "regular", icon, kbd, loading, disabled, state, submit, shortcut, ariaLabel, expanded, chevron, flash, attrs, onAction, onKeyDown, ...o }: PushButtonProps) {
  // @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-user-input
  const onClick = (e: MouseEvent) => {
    if (loading) e.preventDefault(); // Space, Return and a click submit a form natively; a busy button must not
    press({ disabled, loading }, onAction);
  };
  // @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-user-input
  // @cpt-begin:cpt-noter-flow-ui-primitives-operate-control:p1:inst-return-control
  // @cpt-begin:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-hug
  return (
    <button
      type={submit ? "submit" : "button"}
      className={cx("np-btn", `np-btn--${variant}`, `np-btn--${size}`, o.cls)}
      {...base("push-button", { ...o, variant, size, state: buttonState({ loading, disabled, state }) })}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-busy={loading || undefined}
      {...attrs}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {loading ? <span className="np-spin" aria-hidden="true" /> : icon && <Icon name={icon} size={size === "small" ? 12 : 14} />}
      {flash ? (
        <span className="np-btn__flash">
          <Icon name="check" size={12} />
          {flash}
        </span>
      ) : (
        <span>{label}</span>
      )}
      {kbd && <KeyCap keys={kbd} />}
      {chevron && <Icon name="chevronDown" size={10} cls="np-btn__chev" />}
    </button>
  );
  // @cpt-end:cpt-noter-algo-ui-primitives-fit-labels:p1:inst-hug
  // @cpt-end:cpt-noter-flow-ui-primitives-operate-control:p1:inst-return-control
}
