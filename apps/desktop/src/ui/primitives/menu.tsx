// menu of the prototype's src/js/02-primitives.js: context menu or item menu (⋯). ↑/↓, Home and End move,
// Return or Space runs an item, Esc closes; focus starts on the first item and returns to the opener.
import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../icons";
import { base, cx } from "./attrs";
import { moveFocus } from "./roving";
import { useFocusInside } from "./sheet";

export type MenuItem =
  | { divider: true }
  | { header: string }
  | { label: string; onSelect?: () => void; disabled?: boolean; destructive?: boolean; checked?: boolean; submenu?: boolean; kbd?: string; /** A submenu: opens beside the item on hover, → or a click, and takes focus. */ children?: MenuItem[] };

const ITEM = '[role^="menuitem"]:not(:disabled)';

export function menuKey(e: KeyboardEvent<HTMLElement>, onClose?: () => void) {
  if (e.key === "Escape") {
    // consumed here, so a sheet or popover around the menu stays open
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  }
  else moveFocus(e, ITEM);
}

/** → opens an item's submenu and ← closes it. */
export const submenuKey = (key: string): "open" | "close" | null => (key === "ArrowRight" ? "open" : key === "ArrowLeft" ? "close" : null);

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
        return it.children ? <SubItem key={i} it={it} onClose={onClose} /> : leaf(it, onClose, i);
      })}
    </div>
  );
}

type Leaf = Extract<MenuItem, { label: string }>;

function leaf(it: Leaf, onClose?: () => void, key?: number, sub?: { open: boolean; onOpen: (open: boolean) => void }) {
  return (
    <button
      key={key}
      type="button"
      // a checkable item is a menuitemcheckbox: aria-checked is not valid on a plain menuitem
      role={it.checked == null ? "menuitem" : "menuitemcheckbox"}
      className={cx("np-menu__item", it.destructive && "is-danger")}
      tabIndex={-1}
      aria-checked={it.checked}
      aria-haspopup={sub ? "menu" : undefined}
      aria-expanded={sub ? sub.open : undefined}
      disabled={it.disabled}
      onClick={() => (sub ? sub.onOpen(true) : (it.onSelect?.(), onClose?.()))}
      onKeyDown={(e) => {
        const k = sub && submenuKey(e.key);
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        sub.onOpen(k === "open");
      }}
    >
      <span className="np-menu__check">{it.checked && <Icon name="check" size={12} />}</span>
      <span className="np-menu__label">{it.label}</span>
      {(it.submenu || sub) && <Icon name="chevronRight" size={11} />}
      {it.kbd && <span className="np-menu__kbd">{it.kbd}</span>}
    </button>
  );
}

function SubItem({ it, onClose }: { it: Leaf; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="np-menu__sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {leaf(it, onClose, undefined, { open, onOpen: setOpen })}
      {open && <SubPanel it={it} onClose={onClose} onBack={() => setOpen(false)} />}
    </div>
  );
}

function SubPanel({ it, onClose, onBack }: { it: Leaf; onClose?: () => void; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusInside(ref); // its first item, so the keyboard can choose; focus goes back to the parent item when it closes
  return (
    <div
      ref={ref}
      className="np-menu np-menu__subpanel"
      role="menu"
      aria-label={it.label}
      onKeyDown={(e) => {
        if (submenuKey(e.key) !== "close") return menuKey(e, onClose);
        e.preventDefault();
        e.stopPropagation();
        onBack();
      }}
    >
      {it.children!.map((c, i) => ("label" in c ? leaf(c, onClose, i) : null))}
    </div>
  );
}
