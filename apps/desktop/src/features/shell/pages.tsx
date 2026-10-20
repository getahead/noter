import type { ReactNode } from "react";

import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import type { CollapseInput } from "./collapse";
import type { Route, SectionKey } from "./history";
import { sectionOf } from "./sections";

/** What a page registers with the shell (MW-R3), and optionally its trailing inspector (MW-R4). */
export interface PageDef {
  title: (route: Route) => string;
  subtitle?: (route: Route) => string;
  render: (route: Route) => ReactNode;
  /** The content width the page needs with its full layout, with one-column grids and with fewer columns. */
  need?: CollapseInput["need"];
  /** The page's default inspector (⌥⌘I); 280 for Call info, 320 for the Item inspector, 400 for the Handoff drawer. */
  inspector?: { width: 280 | 320 | 400; label: MsgKey; render: () => ReactNode };
  /** The page's own toolbar actions; at Narrow all but the primary one overflow into » from the trailing side. */
  actions?: Array<{ label: string; onAction: () => void; primary?: boolean }>;
  /** The page has no search field (the prototype's `search: false`). */
  search?: false;
}

const pages = new Map<SectionKey, PageDef>();

// @cpt-dod:cpt-noter-dod-ui-main-window-shell-navigation:p1
/** Later features register their page for a section; the last registration wins. */
export function registerPage(section: SectionKey, def: PageDef): void {
  pages.set(section, def);
}

/** A section whose feature has not landed: an empty state naming it, never a blank area. */
const placeholder = (section: SectionKey): PageDef => {
  const name = t(sectionOf(section).label);
  return {
    title: () => name,
    render: () => <EmptyState variant="large" heading icon="wand" title={t("section.empty_title", { section: name })} body={t("section.empty_body")} />,
  };
};

export const pageFor = (section: SectionKey): PageDef => pages.get(section) ?? placeholder(section);
