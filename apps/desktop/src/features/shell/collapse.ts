export type WidthClass = "wide" | "medium" | "narrow";
export type CollapseStep = "none" | "inspector" | "grid" | "columns" | "sidebar";

export interface CollapseInput {
  /**
   * The layout width the page sees, in CSS points at the zoom in force: the window's width divided by zoom/100
   * (at 200 % a 1440-pt window is 720 pt of layout). The caller passes it already zoomed, so the width class and
   * the grid and column steps follow the zoom through it.
   */
  windowWidth: number;
  /** Zoom in percent (100 = actual size). Only the sidebar rule reads it: 175 % or more collapses the sidebar. */
  zoom: number;
  /** 180 to 320 pt. */
  sidebarWidth: number;
  /** Width of the docked inspector (280, 320 or 400), null when none is docked. */
  inspectorWidth: number | null;
  /** The content width the page needs with its full layout, with one-column grids, and with fewer columns too. */
  need: { full: number; singleColumn: number; fewerColumns: number };
}

export interface CollapseResult {
  widthClass: WidthClass;
  /** The last step applied; each step includes the ones before it. */
  step: CollapseStep;
  inspector: "docked" | "overlay" | "none";
  grid: "multi" | "single";
  columns: "all" | "reduced";
  sidebar: "docked" | "overlay";
}

// @cpt-algo:cpt-noter-algo-ui-main-window-shell-collapse:p1
// @cpt-dod:cpt-noter-dod-ui-main-window-shell-collapse:p1
export function collapse({ windowWidth, zoom, sidebarWidth, inspectorWidth, need }: CollapseInput): CollapseResult {
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-content-width
  const content = windowWidth - sidebarWidth - (inspectorWidth ?? 0);
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-content-width
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-class
  const widthClass: WidthClass = content >= 1100 ? "wide" : content >= 760 ? "medium" : "narrow";
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-class
  let step: CollapseStep = "none";
  let available = content;
  let inspector: CollapseResult["inspector"] = inspectorWidth === null ? "none" : "docked";
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-inspector
  if (inspectorWidth !== null && available < need.full) {
    inspector = "overlay";
    available += inspectorWidth;
    step = "inspector";
  }
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-inspector
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-grid
  const grid = available < need.full ? "single" : "multi";
  if (grid === "single") step = "grid";
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-grid
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-columns
  const columns = available < need.singleColumn ? "reduced" : "all";
  if (columns === "reduced") step = "columns";
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-columns
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-sidebar
  const sidebar = windowWidth < 900 || zoom >= 175 ? "overlay" : "docked";
  if (sidebar === "overlay") step = "sidebar";
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-step-sidebar
  // @cpt-begin:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-return-class
  return { widthClass, step, inspector, grid, columns, sidebar };
  // @cpt-end:cpt-noter-algo-ui-main-window-shell-collapse:p1:inst-return-class
}
