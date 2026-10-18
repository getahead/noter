import type { MouseEvent } from "react";

import { Icon, type IconName } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface LinkProps extends Common {
  label: string;
  href?: string;
  /** Opens in another app: a trailing ↗; `ariaLabel` says "opens in …". */
  external?: boolean;
  icon?: IconName;
  ariaLabel?: string;
  lang?: string;
  /** Runs instead of following the href. */
  onAction?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** link: inline or external, in the accent text colour; Return follows it. */
export function Link({ label, href = "#", external, icon, ariaLabel, lang, onAction, ...o }: LinkProps) {
  const onClick = onAction
    ? (e: MouseEvent) => {
        e.preventDefault();
        onAction();
      }
    : undefined;
  return (
    <a href={href} className={cx("np-link", o.cls)} {...base("link", { variant: external ? "external" : "inline", ...o })} aria-label={ariaLabel} lang={lang} onClick={onClick}>
      {icon && <Icon name={icon} size={12} />}
      {label}
      {external && (
        <span className="np-link__ext" aria-hidden="true">
          ↗
        </span>
      )}
    </a>
  );
}
