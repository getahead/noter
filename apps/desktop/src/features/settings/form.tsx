import type { ReactNode } from "react";

import { Icon } from "../../ui/icons";

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
export function Row({ label, note, stack, error, children }: { label?: string; note?: ReactNode; stack?: boolean; error?: string | null; children: ReactNode }) {
  return (
    <div className={stack ? "st-row is-stack" : "st-row"}>
      <div className="st-row__label">{label}</div>
      <div className="st-row__ctl">
        {children}
        {note && <div className="st-row__note">{note}</div>}
        {/* a refusal shows under the row it belongs to, and goes when a later save succeeds */}
        <div className="st-row__live" aria-live="polite">
          {error && (
            <span className="st-row__err">
              <Icon name="warning" size={12} />
              {error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
