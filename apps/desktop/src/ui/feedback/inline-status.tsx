// Inline status of the prototype's src/js/04-shared.js (C.inlineStatus): the confirmation where the eye is, on the
// label, trailing, blind feedback, row outcome or notice. It never takes focus; failures use the inline banner.
import { useEffect, useRef } from "react";
import { Icon } from "../icons";
import { KeyCap } from "../primitives/key-cap";
import { Link } from "../primitives/link";
import { STATUS_MS, statusTimer, type StatusTimer, type StatusVariant } from "./status-timer";

export interface InlineStatusProps {
  // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-receive-status
  text: string;
  variant?: StatusVariant;
  // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-receive-status
  /** Undo on a row outcome. */
  actionLabel?: string;
  onAction?: () => void;
  kbd?: string;
  /** The time ended or the action ran: the owner removes the status and its control shows its own label. */
  onExpire: () => void;
}

/** Pointer and focus handlers that pause the timer of a status with an action. */
export function statusHandlers(timer: { current: StatusTimer | null }, hasAction: boolean) {
  if (!hasAction) return {};
  // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-while-hover
  const pause = () => timer.current?.pause();
  const resume = () => timer.current?.resume();
  return { onPointerEnter: pause, onFocus: pause, onPointerLeave: resume, onBlur: resume };
  // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-while-hover
}

// @cpt-flow:cpt-noter-flow-ui-primitives-inline-status:p1
// @cpt-dod:cpt-noter-dod-ui-primitives-feedback:p1
export function InlineStatus({ text, variant = "trailing", actionLabel, onAction, kbd, onExpire }: InlineStatusProps) {
  const timer = useRef<StatusTimer | null>(null);
  // @cpt-begin:cpt-noter-state-ui-primitives-inline-status:p1:inst-hidden-shown
  useEffect(() => {
    if (!text) return;
    timer.current = statusTimer(STATUS_MS[variant], onExpire);
    return timer.current.cancel;
  }, [text, variant]); // not onExpire: an owner re-rendering with a new callback must not restart the time
  // @cpt-end:cpt-noter-state-ui-primitives-inline-status:p1:inst-hidden-shown
  if (!text) return null;
  // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-return-label
  const undo = () => (onAction?.(), onExpire());
  // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-return-label
  // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-show-status
  return (
    <span
      data-component="cpt-noter-component-ui-inline-status"
      data-variant={variant}
      data-state="shown"
      className={`np-istatus np-istatus--${variant}`}
      role="status"
      {...statusHandlers(timer, !!actionLabel)}
    >
      <Icon name={variant === "notice" ? "info" : "check"} size={12} />
      <span className="np-istatus__text">{text}</span>
      {actionLabel && <Link label={actionLabel} onAction={undo} />}
      {kbd && <KeyCap keys={kbd} />}
    </span>
  );
  // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-show-status
}
