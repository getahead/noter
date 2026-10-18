import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SplitDivider, splitKey } from "./split-divider";

describe("SplitDivider (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the prototype's decorative divider when nothing resizes it", () => {
    expect(renderToString(<SplitDivider />)).toBe('<div class="np-split" role="separator" aria-orientation="vertical" data-component="cpt-noter-component-ui-primitives" data-primitive="split-divider" data-variant="vertical"></div>');
  });

  it("is an adjustable, focusable separator when it resizes a pane", () => {
    const html = renderToString(<SplitDivider value={240} min={180} max={420} label="Sidebar width" onChange={() => {}} />);
    expect(html).toContain('tabindex="0" aria-valuenow="240" aria-valuemin="180" aria-valuemax="420" aria-label="Sidebar width"');
  });
});

describe("splitKey", () => {
  const range = { min: 180, max: 420, step: 10 };
  it("resizes with ←/→ within the range", () => {
    expect(splitKey("ArrowRight", 240, range)).toBe(250);
    expect(splitKey("ArrowLeft", 240, range)).toBe(230);
    expect(splitKey("ArrowLeft", 185, range)).toBe(180);
    expect(splitKey("ArrowRight", 415, range)).toBe(420);
  });
  it("goes to the ends with Home and End and ignores other keys", () => {
    expect(splitKey("Home", 240, range)).toBe(180);
    expect(splitKey("End", 240, range)).toBe(420);
    expect(splitKey("ArrowUp", 240, range)).toBeNull();
  });
});

describe("SplitDivider resizing", () => {
  it("resizes by key, by dragging and collapses on a double-click", async () => {
    const { rendered } = await import("../testing");
    const onChange = vi.fn();
    const onCollapse = vi.fn();
    const div = rendered(SplitDivider, { value: 240, min: 180, max: 420, onChange, onCollapse }).props as Record<string, (e: unknown) => void>;
    const preventDefault = vi.fn();
    div.onKeyDown({ key: "ArrowRight", preventDefault });
    div.onKeyDown({ key: "ArrowUp", preventDefault });
    expect(onChange).toHaveBeenLastCalledWith(250);
    expect(preventDefault).toHaveBeenCalledOnce();
    const setPointerCapture = vi.fn();
    div.onPointerMove({ clientX: 500 }); // not dragging yet
    div.onPointerDown({ pointerId: 1, clientX: 300, currentTarget: { setPointerCapture } });
    div.onPointerMove({ clientX: 330 });
    expect(onChange).toHaveBeenLastCalledWith(270);
    div.onPointerMove({ clientX: 900 });
    expect(onChange).toHaveBeenLastCalledWith(420);
    div.onPointerUp({});
    div.onPointerMove({ clientX: 100 });
    expect(onChange).toHaveBeenCalledTimes(3);
    div.onPointerCancel({});
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(div.onDoubleClick).toBe(onCollapse);
  });
});
