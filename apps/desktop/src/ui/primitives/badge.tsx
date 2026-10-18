import { Icon, type IconName } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface BadgeProps extends Common {
  text: string;
  /** count (capsule), kind (hairline outline) or status (tinted fill). */
  kind?: "count" | "kind" | "status";
  tone?: "neutral" | "info" | "warning" | "error" | "success" | "accent";
  icon?: IconName;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** badge: read as text with its parent; a status tag always carries a word. */
export function Badge({ text, kind = "status", tone = "neutral", icon, ...o }: BadgeProps) {
  return (
    <span className={cx("np-badge", `np-badge--${kind}`, `np-badge--${tone}`, o.cls)} {...base("badge", { variant: kind + (kind === "status" ? `-${tone}` : ""), ...o })}>
      {icon && <Icon name={icon} size={11} />}
      {text}
    </span>
  );
}
