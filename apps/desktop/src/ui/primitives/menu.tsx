// menu of the prototype's src/js/02-primitives.js: context menu or item menu (⋯). ↑/↓, Home and End move,
// Return or Space runs an item, Esc closes; focus starts on the first item and returns to the opener.
import { useRef, type KeyboardEvent } from "react";
import { Icon } from "../icons";
import { base, cx } from "./attrs";
import { moveFocus } from "./roving";
import { useFocusInside } from "./sheet";

export type MenuItem =
  | { divider: true }
  | { header: string }
  | { label: string; onSelect?: () => void; disabled?: boolean; destructive?: boolean; checked?: boolean; submenu?: boolean; kbd?: string };

const ITEM = '[role^="menuitem"]:not(:disabled)';

export function menuKey(e: KeyboardEvent<HTMLElement>, onClose?: () => void) {
  if (e.key === "Escape") onClose?.();
  else moveFocus(e, ITEM);
}

export interface MenuProps {
  items: MenuItem[];
  /** item-menu (default) | context-menu */
  variant?: string;
  label?: string;
  /** Closes the menu: Esc, or after an item ran. */
  onClose?: () => void;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
export function Menu({ items, variant = "item-menu", label, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusInside(ref); // the first enabled item; focus goes back to the opener when the menu closes
  return (
    <div ref={ref} className="np-menu" role="menu" {...base("menu", { variant })} aria-label={label} onKeyDown={(e) => menuKey(e, onClose)}>
      {items.map((it, i) => {
        if ("divider" in it) return <div key={i} className="np-menu__sep" role="separator" />;
        if ("header" in it) return <div key={i} className="np-menu__hdr">{it.header}</div>;
        return (
          <button
            key={i}
            type="button"
            // a checkable item is a menuitemcheckbox: aria-checked is not valid on a plain menuitem
            role={it.checked == null ? "menuitem" : "menuitemcheckbox"}
            className={cx("np-menu__item", it.destructive && "is-danger")}
            tabIndex={-1}
            aria-checked={it.checked}
            disabled={it.disabled}
            onClick={() => (it.onSelect?.(), onClose?.())}
          >
            <span className="np-menu__check">{it.checked && <Icon name="check" size={12} />}</span>
            <span className="np-menu__label">{it.label}</span>
            {it.submenu && <Icon name="chevronRight" size={11} />}
            {it.kbd && <span className="np-menu__kbd">{it.kbd}</span>}
          </button>
        );
      })}
    </div>
  );
}
