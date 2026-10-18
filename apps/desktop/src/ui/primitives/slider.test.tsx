import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Slider, sliderKey } from "./slider";

describe("slider", () => {
  it("is a slider with value text, paired with a number field", () => {
    const html = renderToString(<Slider value={18} unit="%" label="Threshold" valueText="18 percent" />);
    expect(html).toMatch(/^<span class="np-slider" data-component="cpt-noter-component-ui-primitives" data-primitive="slider" data-variant="with-field">/);
    expect(html).toContain('<input type="range" min="0" max="100" step="1" aria-label="Threshold" aria-valuetext="18 percent" value="18"/>');
    expect(html).toContain('<span class="np-field np-field--number" data-primitive="text-field" data-variant="number"><input class="np-field__input np-tnum" type="number" min="0" max="100" aria-label="Threshold" value="18"/></span>');
    expect(html).toContain('<span class="np-slider__unit">%</span>');
    expect(renderToString(<Slider value={4} unit=" s" />)).toContain('aria-valuetext="4 s"');
    expect(renderToString(<Slider value={4} disabled />)).toContain('data-state="disabled"');
  });

  it("steps with ←/→ and ten steps with ⇧, within its range", () => {
    const s = { value: 18, min: 0, max: 100, step: 1 };
    expect(sliderKey("ArrowRight", false, s)).toBe(19);
    expect(sliderKey("ArrowLeft", true, s)).toBe(8);
    expect(sliderKey("ArrowDown", true, { ...s, value: 3 })).toBe(0);
    expect(sliderKey("ArrowUp", true, { ...s, value: 95 })).toBe(100);
    expect(sliderKey("Home", false, s)).toBeNull();
  });

  it("reports the new value to the owner from the keys, the slider and the field", () => {
    const onAction = vi.fn();
    const [range, field] = Slider({ value: 18, onAction }).props.children;
    const preventDefault = vi.fn();
    range.props.onKeyDown({ key: "ArrowRight", shiftKey: true, preventDefault });
    range.props.onKeyDown({ key: "Tab", shiftKey: false, preventDefault });
    expect(onAction).toHaveBeenLastCalledWith(28);
    expect(preventDefault).toHaveBeenCalledOnce();
    range.props.onChange({ target: { value: "40" } });
    field.props.children.props.onChange({ target: { value: "41" } });
    expect(onAction).toHaveBeenLastCalledWith(41);
  });
});
