// person-chip: the call window's chip (prototype C.personChip), shared: initials and a short name; a button when the
// owner gives it an action (rename, open the person). The chip never decides what the action does.
import { cx } from "./attrs";

export interface PersonChipProps {
  /** you, call-window, unnamed, link… as data-variant. */
  variant: string;
  initials: string;
  name: string;
  /** The full name in a help tag. */
  title?: string;
  /** A dimmed chip (an unnamed speaker). */
  secondary?: boolean;
  /** VoiceOver name of the button form. */
  label?: string;
  onAction?: (anchor: HTMLElement) => void;
}

// @cpt-component:cpt-noter-component-ui-person-chip:p1
export function PersonChip({ variant, initials, name, title, secondary, label, onAction }: PersonChipProps) {
  const attrs = {
    "data-component": "cpt-noter-component-ui-person-chip",
    "data-variant": variant,
    className: cx("np-person np-person--cw", secondary && "is-secondary"),
    title,
  };
  const contents = (
    <>
      <span className="np-person__ini" aria-hidden="true">
        {initials}
      </span>{" "}
      <span className="np-person__name">{name}</span>{" "}
    </>
  );
  return onAction ? (
    <button {...attrs} type="button" aria-label={label} onClick={(e) => onAction(e.currentTarget)}>
      {contents}
    </button>
  ) : (
    <span {...attrs}>{contents}</span>
  );
}
