import { describe, expect, it } from "vitest";
import type { DisplayInfo } from "../../core/bindings";
import { AUTO_DISPLAY, defaultDisplay } from "./default-display";

const d = (id: string, name: string, holds_call_app = false): DisplayInfo => ({ id, name, is_main: false, holds_call_app, width_pt: 1920, height_pt: 1080 });
const two = [d("d1", "Built-in Retina Display", true), d("d2", "Studio Display")];

describe("defaultDisplay (cpt-noter-algo-ui-first-run-default-display)", () => {
  it("returns the one-display variant with only the default option", () => {
    expect(defaultDisplay([d("d1", "Built-in Retina Display", true)], "d1")).toEqual({
      variant: "one-display",
      options: [{ value: AUTO_DISPLAY, label: "The display without the call app", connected: true }],
      selected: AUTO_DISPLAY,
    });
  });

  it("lists the recommended default first, then each display, marking where the call app is", () => {
    const p = defaultDisplay(two, null);
    expect(p.variant).toBe("several");
    expect(p.options.map((o) => [o.value, o.label, o.note])).toEqual([
      [AUTO_DISPLAY, "The display without the call app", "Recommended"],
      ["d1", "Built-in Retina Display · Call app is here", undefined],
      ["d2", "Studio Display", undefined],
    ]);
    expect(p.selected).toBe(AUTO_DISPLAY);
  });

  it("selects the remembered display when it is connected", () => {
    expect(defaultDisplay(two, "d2").selected).toBe("d2");
  });

  it("lists a remembered display that is not connected, selectable, under its name", () => {
    const p = defaultDisplay(two, "gone", "LG UltraFine 5K");
    expect(p.variant).toBe("absent");
    expect(p.options.at(-1)).toEqual({ value: "gone", label: "LG UltraFine 5K (not connected)", connected: false });
    expect(p.selected).toBe("gone");
  });

  it("names an absent display Unknown display when the caller has no name", () => {
    expect(defaultDisplay(two, "gone").options.at(-1)?.label).toBe("Unknown display (not connected)");
  });

  it("offers only the default when no display is reported", () => {
    const p = defaultDisplay([], null);
    expect(p.variant).toBe("several");
    expect(p.options).toHaveLength(1);
  });
});
