import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { labelsFit, segmentKey, SegmentedControl, SegmentTrack } from "./segmented-control";

const items = [{ value: "list", label: "List", icon: "list" as const }, { value: "board", label: "Board", count: 4 }, { value: "map", label: "Map", disabled: true }];

describe("segmented-control", () => {
  it("is a tab list of tabs as a view switch, with the selected segment marked", () => {
    const html = renderToString(<SegmentedControl items={items} value="board" label="View" region="MW-R1" />);
    expect(html).toMatch(/^<div class="np-seg" role="tablist" data-component="cpt-noter-component-ui-primitives" data-primitive="segmented-control" data-variant="view" data-region="MW-R1" aria-label="View">/);
    expect(html).toContain('<button type="button" class="np-seg__item" role="tab" aria-selected="false" tabindex="-1"><svg');
    expect(html).toContain('class="np-seg__item is-sel" role="tab" aria-selected="true" tabindex="0">Board<!-- --> <span class="np-seg__count">4</span></button>');
    expect(html).toContain('tabindex="-1" disabled="">Map</button>');
  });

  it("is a radio group of radios as a form option", () => {
    const html = renderToString(<SegmentedControl items={["Claude Code", "Codex"]} value="Codex" variant="option" label="Default tool" />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-variant="option"');
    expect(html).toContain('role="radio" aria-checked="false" tabindex="-1">Claude Code</button>');
    expect(html).toContain('role="radio" aria-checked="true" tabindex="0">Codex</button>');
  });

  it("moves with ←/→, skipping disabled segments and wrapping", () => {
    const off = [false, false, true];
    expect(segmentKey("ArrowRight", off, 0)).toBe(1);
    expect(segmentKey("ArrowRight", off, 1)).toBe(0);
    expect(segmentKey("ArrowLeft", off, 0)).toBe(1);
    expect(segmentKey("ArrowDown", off, 0)).toBeNull();
    expect(segmentKey("ArrowRight", [true], 0)).toBeNull();
  });

  const press = (variant: "view" | "option", key: string) => {
    const onAction = vi.fn();
    const buttons = [0, 1, 2].map(() => ({ focus: vi.fn() }));
    const event = { key, target: buttons[0], currentTarget: { querySelectorAll: () => buttons }, preventDefault: vi.fn() };
    SegmentTrack({ items, value: "list", variant, onAction }).props.onKeyDown(event);
    return { onAction, buttons, event };
  };

  it("selects as focus moves in a view switch; an option only moves focus", () => {
    const view = press("view", "ArrowRight");
    expect(view.buttons[1].focus).toHaveBeenCalled();
    expect(view.event.preventDefault).toHaveBeenCalled();
    expect(view.onAction).toHaveBeenCalledWith("board");
    const option = press("option", "ArrowLeft");
    expect(option.buttons[1].focus).toHaveBeenCalled();
    expect(option.onAction).not.toHaveBeenCalled();
    expect(press("view", "Tab").event.preventDefault).not.toHaveBeenCalled();
  });

  it("passes a clicked segment's value to the owner", () => {
    const onAction = vi.fn();
    SegmentTrack({ items, value: "list", onAction }).props.children[1].props.onClick();
    expect(onAction).toHaveBeenCalledWith("board");
  });

  it("keeps segments while their labels fit and falls back to a pop-up when they do not", () => {
    expect(labelsFit(180, 200)).toBe(true);
    expect(labelsFit(200, 200)).toBe(true);
    expect(labelsFit(240, 200)).toBe(false);
  });
});
