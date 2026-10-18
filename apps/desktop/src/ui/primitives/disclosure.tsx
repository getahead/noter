import type { ReactNode } from "react";

import { Icon } from "../icons";
import { base, cx, type Common } from "./attrs";

export interface DisclosureProps extends Common {
  label: string;
  open: boolean;
  /** section or row. */
  variant?: "section" | "row";
  trailing?: ReactNode;
  onAction?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** disclosure: a button with an expanded state; Space or Return toggles it and the triangle rotates. */
export function Disclosure({ label, open, variant = "section", trailing, onAction, ...o }: DisclosureProps) {
  return (
    <button type="button" className={cx("np-disc", `np-disc--${variant}`, open && "is-open", o.cls)} aria-expanded={open} {...base("disclosure", { ...o, variant, state: open ? "expanded" : "collapsed" })} onClick={onAction}>
      <Icon name="chevronRight" size={11} cls="np-disc__tri" />
      <span>{label}</span>
      {trailing}
    </button>
  );
}
