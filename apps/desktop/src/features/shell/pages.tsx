import type { ComponentType, ReactNode } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import type { CollapseInput } from "./collapse";
import type { Route, SectionKey } from "./history";
import { sectionOf } from "./sections";
import type { ToolbarProps } from "./toolbar";

/** What a page registers with the shell (MW-R3), and optionally its trailing inspector (MW-R4). */
export interface PageDef {
  title: (route: Route) => string;
  subtitle?: (route: Route) => string;
  /** The shell always passes the window's bridge; it is optional so a page that has no use for it needs no parameter. */
  render: (route: Route, bridge?: Bridge) => ReactNode;
  /** The content width the page needs with its full layout, with one-column grids and with fewer columns. */
  need?: CollapseInput["need"];
  /** The page's default inspector (⌥⌘I); 280 for Call info, 320 for the Item inspector, 400 for the Handoff drawer. */
  inspector?: { width: 280 | 320 | 400; label: MsgKey; render: (route: Route, bridge: Bridge) => ReactNode; /** Docked open on arrival at Wide width (Call info). */ openByDefault?: boolean };
  /** The page's own toolbar (PC-R1): it draws the shell's `MainToolbar` with the page's pieces in it. */
  toolbar?: ComponentType<PageToolbarProps>;
  /** The page's own banners (PC-R2), shown after the app's banners; `appBanners` is how many of those there are. */
  banners?: ComponentType<{ route: Route; bridge: Bridge; appBanners: number }>;
  /** The page's own toolbar actions; at Narrow all but the primary one overflow into » from the trailing side. */
  actions?: Array<{ label: string; onAction: () => void; primary?: boolean }>;
  /** The page has no search field (the prototype's `search: false`). */
  search?: false;
}

/** What the shell hands a page's own toolbar: the shell's toolbar props, and the inspector's state. */
export interface PageToolbarProps {
  route: Route;
  bridge: Bridge;
  base: ToolbarProps;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
}

interface Registered {
  def: PageDef;
  /** The routes of the section this page shows; a page without it shows the rest. */
  when?: (route: Route) => boolean;
}
const pages = new Map<SectionKey, Registered[]>();

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
/** Later features register their page for a section, or for the routes of it `when` accepts; the last registration wins. */
export function registerPage(section: SectionKey, def: PageDef, when?: (route: Route) => boolean): void {
  pages.set(section, [...(pages.get(section) ?? []).filter((r) => r.when !== when), { def, when }]);
}

/** A section whose feature has not landed: an empty state naming it, never a blank area. */
const placeholder = (section: SectionKey): PageDef => {
  const name = t(sectionOf(section).label);
  return {
    title: () => name,
    render: () => <EmptyState variant="large" heading icon="wand" title={t("section.empty_title", { section: name })} body={t("section.empty_body")} />,
  };
};

/** The page for a section, or for the route inside it when a page registered `when` accepts that route. */
export const pageFor = (section: SectionKey, route?: Route): PageDef => {
  const all = pages.get(section) ?? [];
  return (all.find((r) => route && r.when?.(route)) ?? all.find((r) => !r.when))?.def ?? placeholder(section);
};
