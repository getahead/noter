import { describe, expect, it } from "vitest";

import { collapse, type CollapseInput } from "./collapse";

const base: CollapseInput = {
  windowWidth: 1400,
  zoom: 100,
  sidebarWidth: 220,
  inspectorWidth: null,
  need: { full: 700, singleColumn: 600, fewerColumns: 500 },
};
const run = (o: Partial<CollapseInput>) => collapse({ ...base, ...o });

describe("collapse", () => {
  it("leaves a wide window alone", () => {
    expect(run({})).toEqual({
      widthClass: "wide",
      step: "none",
      inspector: "none",
      grid: "multi",
      columns: "all",
      sidebar: "docked",
    });
  });

  it("classes by content width: window − sidebar − docked inspector", () => {
    expect(run({ windowWidth: 1320 }).widthClass).toBe("wide"); // 1100
    expect(run({ windowWidth: 1319 }).widthClass).toBe("medium");
    expect(run({ windowWidth: 980 }).widthClass).toBe("medium"); // 760
    expect(run({ windowWidth: 979 }).widthClass).toBe("narrow");
    expect(run({ windowWidth: 1500, inspectorWidth: 400 }).widthClass).toBe("medium"); // 880
  });

  it("first stops docking the inspector", () => {
    const r = run({ windowWidth: 1100, inspectorWidth: 320 }); // content 560 < 700
    expect(r).toMatchObject({ step: "inspector", inspector: "overlay", grid: "multi", columns: "all" });
    // overlaying gives the 320 back: 880 ≥ 700
  });

  it("then makes grids one column", () => {
    const r = run({ windowWidth: 900, inspectorWidth: 280, sidebarWidth: 180 }); // 440; overlay → 720 ≥ 700, so the inspector is enough
    expect(r.step).toBe("inspector");
    const g = run({ windowWidth: 1050, need: { full: 900, singleColumn: 700, fewerColumns: 500 } }); // 830 < 900, ≥ 700
    expect(g).toMatchObject({ step: "grid", grid: "single", columns: "all" });
  });

  it("then hides low-priority columns", () => {
    const r = run({ windowWidth: 1000, need: { full: 900, singleColumn: 800, fewerColumns: 500 } }); // 780 < 800
    expect(r).toMatchObject({ step: "columns", grid: "single", columns: "reduced" });
  });

  it("collapses the sidebar below 900 pt, or from 175 % zoom, as the last step", () => {
    expect(run({ windowWidth: 899, need: { full: 100, singleColumn: 100, fewerColumns: 100 } })).toMatchObject({ step: "sidebar", sidebar: "overlay" });
    expect(run({ zoom: 175 })).toMatchObject({ step: "sidebar", sidebar: "overlay" });
    expect(run({ zoom: 174 }).sidebar).toBe("docked");
    expect(run({ windowWidth: 900 }).sidebar).toBe("docked");
  });

  it("keeps the earlier steps when the sidebar collapses", () => {
    expect(run({ windowWidth: 800, need: { full: 900, singleColumn: 800, fewerColumns: 500 } })).toMatchObject({ step: "sidebar", sidebar: "overlay", columns: "reduced", grid: "single" });
  });

  it("takes the width the page sees at the zoom in force: 200 % of a 1440-pt window is 720 pt of layout (QA Q-1)", () => {
    const zoom = 200;
    const r = collapse({ windowWidth: 1440 / (zoom / 100), zoom, sidebarWidth: 220, inspectorWidth: null, need: { full: 900, singleColumn: 480, fewerColumns: 320 } });
    // 720 − 220 = 500 pt of content: Narrow, and a page that needs 900 pt goes to one column; the sidebar is an overlay
    expect(r).toMatchObject({ widthClass: "narrow", grid: "single", sidebar: "overlay", step: "sidebar" });
    // the same window at 100 % keeps everything docked
    expect(collapse({ windowWidth: 1440, zoom: 100, sidebarWidth: 220, inspectorWidth: null, need: { full: 900, singleColumn: 480, fewerColumns: 320 } })).toMatchObject({ widthClass: "wide", grid: "multi", sidebar: "docked", step: "none" });
  });
});
