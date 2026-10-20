// Empty state of the prototype's src/js/04-shared.js (C.emptyState): first use, filtered empty, section line and
// large area (docs/features/ui/primitives.md). Its action is the owner's.
import { Icon, type IconName } from "../icons";
import { Link } from "../primitives/link";
import { PushButton } from "../primitives/push-button";

export interface EmptyStateProps {
  variant?: "first-use" | "filtered" | "section" | "large";
  title: string;
  body?: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  linkLabel?: string;
  onLink?: () => void;
  /** The title is the page's heading: an h2 the shell moves focus to after navigation. */
  heading?: boolean;
}

const root = (variant: string) => ({ "data-component": "cpt-noter-component-ui-empty-state", "data-variant": variant });

// @cpt-dod:cpt-noter-dod-ui-primitives-feedback:p1
export function EmptyState({ variant = "first-use", title, body, icon = "inbox", actionLabel, onAction, linkLabel, onLink, heading }: EmptyStateProps) {
  if (variant === "section") return <div {...root(variant)} className="np-empty np-empty--section">{title}</div>;
  return (
    <div {...root(variant)} className={`np-empty np-empty--${variant}`}>
      {variant !== "filtered" && (
        <div className="np-empty__glyph">
          <Icon name={icon} size={28} />
        </div>
      )}
      {heading ? (
        <h2 className="np-empty__title" tabIndex={-1}>
          {title}
        </h2>
      ) : (
        <div className="np-empty__title">{title}</div>
      )}
      {body && <div className="np-empty__body">{body}</div>}
      {actionLabel && (
        <div className="np-empty__act">
          <PushButton label={actionLabel} variant={variant === "filtered" ? "secondary" : "primary"} onAction={onAction} />
        </div>
      )}
      {linkLabel && (
        <div>
          <Link label={linkLabel} onAction={onLink} />
        </div>
      )}
    </div>
  );
}
