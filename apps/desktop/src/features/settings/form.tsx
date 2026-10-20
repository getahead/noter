import type { ReactNode } from "react";

import "./settings.css";

/** A titled group of a pane: the grouped inset form of ST-R2. */
export function Group({ title, foot, children }: { title?: string; foot?: ReactNode; children: ReactNode }) {
  return (
    <section className="st-group">
      {title && <h3 className="st-group__h">{title}</h3>}
      <div className="st-group__box">{children}</div>
      {foot && <div className="st-group__foot">{foot}</div>}
    </section>
  );
}

/** One row: the label at 40 %, the control to its right with an optional note under it. */
export function Row({ label, note, stack, children }: { label?: string; note?: ReactNode; stack?: boolean; children: ReactNode }) {
  return (
    <div className={stack ? "st-row is-stack" : "st-row"}>
      <div className="st-row__label">{label}</div>
      <div className="st-row__ctl">
        {children}
        {note && <div className="st-row__note">{note}</div>}
      </div>
    </div>
  );
}
