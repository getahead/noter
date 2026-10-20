// MW-R1: the unified toolbar of the prototype's `toolbar()`: Back and Forward in one capsule, the page title and
// subtitle, the page's actions and the search field. At Narrow, actions overflow into » from the trailing side
// and the search field becomes an icon button; Back, the title and the primary action never overflow.
import { useState } from "react";

import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import { Toolbar, ToolbarSpacer } from "../../ui/primitives/toolbar";
import type { PageDef } from "./pages";

export interface ToolbarProps {
  title: string;
  subtitle?: string;
  actions: NonNullable<PageDef["actions"]>;
  hasSearch: boolean;
  narrow: boolean;
  canBack: boolean;
  canForward: boolean;
  /** The sidebar is hidden or collapsed: its toggle sits here. */
  showToggle: boolean;
  search: string;
  /** The narrow search field is open. */
  searchOpen: boolean;
  onBack: () => void;
  onForward: () => void;
  onToggleSidebar: () => void;
  onSearch: (value: string) => void;
  onRunSearch: (value: string) => void;
  onOpenSearch: () => void;
}

/** The » menu: the page actions that do not fit at Narrow, opened under the overflow button. */
export function OverflowMenu({ actions, anchor, onClose }: { actions: NonNullable<PageDef["actions"]>; anchor: HTMLElement; onClose: () => void }) {
  return (
    <Popover variant="toolbar-overflow" anchor={anchor} align="end" label={t("shell.more")} onClose={onClose}>
      <Menu
        items={actions.map((a) => ({
          label: a.label,
          onSelect: () => {
            onClose();
            a.onAction();
          },
        }))}
        onClose={onClose}
      />
    </Popover>
  );
}

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-frame:p1
export function MainToolbar(p: ToolbarProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const primary = p.actions.filter((a) => a.primary);
  const shown = p.narrow ? primary : p.actions;
  const overflow = p.narrow ? p.actions.filter((a) => !a.primary) : [];
  return (
    <Toolbar region="MW-R1">
      {p.showToggle && <IconButton icon="sidebar" label={t("shell.show_sidebar")} help={t("shell.show_sidebar_help")} onAction={p.onToggleSidebar} />}
      <span className="np-toolbar__nav">
        <IconButton icon="back" label={t("shell.back")} help={t("shell.back_help")} disabled={!p.canBack} onAction={p.onBack} />
        <IconButton icon="forward" label={t("shell.forward")} help={t("shell.forward_help")} disabled={!p.canForward} onAction={p.onForward} />
      </span>
      <div className="np-toolbar__titles">
        <h1 className="np-toolbar__title" title={p.title}>
          {p.title}
        </h1>
        {p.subtitle && <span className="np-toolbar__sub">{p.subtitle}</span>}
      </div>
      <ToolbarSpacer />
      {(shown.length > 0 || overflow.length > 0) && (
        <div className="np-toolbar__actions">
          {shown.map((a) => (
            <PushButton key={a.label} label={a.label} variant={a.primary ? "primary" : "secondary"} onAction={a.onAction} />
          ))}
          {overflow.length > 0 && (
            <>
              <IconButton id="mw-overflow" icon="ellipsis" label={t("shell.more")} attrs={{ "aria-haspopup": "menu", "aria-expanded": String(anchor !== null) }} onAction={() => setAnchor(anchor ? null : globalThis.document?.getElementById("mw-overflow") ?? null)} />
              {anchor && <OverflowMenu actions={overflow} anchor={anchor} onClose={() => setAnchor(null)} />}
            </>
          )}
        </div>
      )}
      {p.hasSearch &&
        (p.narrow && !p.searchOpen ? (
          <IconButton icon="search" label={t("shell.search")} onAction={p.onOpenSearch} />
        ) : (
          <SearchField id="mw-search" cls="np-toolbar__search" placeholder={t("shell.search_placeholder")} value={p.search} onChange={p.onSearch} onEnter={p.onRunSearch} />
        ))}
    </Toolbar>
  );
}
