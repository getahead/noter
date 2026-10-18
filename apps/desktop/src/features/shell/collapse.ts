export type WidthClass = "wide" | "medium" | "narrow";
export type CollapseStep = "none" | "inspector" | "grid" | "columns" | "sidebar";

export interface CollapseInput {
  windowWidth: number;
  /** Zoom in percent (100 = actual size). */
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
export function collapse({ windowWidth, zoom, sidebarWidth, inspectorWidth, need }: CollapseInput): CollapseResult {
  const content = windowWidth - sidebarWidth - (inspectorWidth ?? 0);
  const widthClass: WidthClass = content >= 1100 ? "wide" : content >= 760 ? "medium" : "narrow";
  let step: CollapseStep = "none";
  let available = content;
  let inspector: CollapseResult["inspector"] = inspectorWidth === null ? "none" : "docked";
  if (inspectorWidth !== null && available < need.full) {
    inspector = "overlay";
    available += inspectorWidth;
    step = "inspector";
  }
  const grid = available < need.full ? "single" : "multi";
  if (grid === "single") step = "grid";
  const columns = available < need.singleColumn ? "reduced" : "all";
  if (columns === "reduced") step = "columns";
  const sidebar = windowWidth < 900 || zoom >= 175 ? "overlay" : "docked";
  if (sidebar === "overlay") step = "sidebar";
  return { widthClass, step, inspector, grid, columns, sidebar };
}
