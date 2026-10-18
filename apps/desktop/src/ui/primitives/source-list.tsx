// source-list of the prototype's sidebar (src/js/05-shell.js): items, group headers, badges and the live row.
// ⌘1 to ⌘8 are the window's shortcuts; the list itself moves with ↑/↓.
import type { MouseEvent, ReactNode } from "react";
import { Icon, type IconName } from "../icons";
import { base, cx } from "./attrs";
import { moveFocus } from "./roving";

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function SourceList({ label = "Sidebar", children }: { label?: string; children?: ReactNode }) {
  return (
    <nav className="np-srclist" role="list" {...base("source-list", {})} aria-label={label} onKeyDown={(e) => moveFocus(e, '[role="listitem"]', false)}>
      {children}
    </nav>
  );
}

export interface SourceListItemProps {
  icon: IconName;
  label: string;
  selected?: boolean;
  /** Count read with the item. */
  badge?: number | string;
  /** Needs attention: a warning glyph read as "problem". */
  warn?: boolean;
  /** Help tag, with the item's shortcut. */
  help?: string;
  onSelect?: () => void;
  /** Trailing content such as a row spinner. */
  children?: ReactNode;
}

export function SourceListItem({ icon, label, selected, badge, warn, help, onSelect, children }: SourceListItemProps) {
  return (
    <a
      href="#"
      role="listitem"
      className={cx("np-srclist__item", selected && "is-sel")}
      data-variant="item"
      data-state={selected ? "selected" : "default"}
      aria-current={selected ? "page" : "false"}
      title={help}
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        onSelect?.();
      }}
    >
      <Icon name={icon} size={15} />
      <span className="np-srclist__label">{label}</span>
      {children}
      {badge ? <span className="np-srclist__badge" data-variant="badge">{badge}</span> : null}
      {warn ? <span className="np-srclist__warn" title="Needs attention"><Icon name="warning" size={12} label="problem" /></span> : null}
    </a>
  );
}

export const SourceListGroup = ({ children }: { children: ReactNode }) => <div className="np-srclist__group" data-variant="group-header">{children}</div>;

/** The red-tinted live row on top of the list while a call records. */
export const SourceListLive = ({ children }: { children: ReactNode }) => <div className="np-srclist__live" data-variant="live-row">{children}</div>;
