import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Slider, sliderKey } from "./slider";

describe("slider", () => {
  it("is a slider with value text, paired with a number field", () => {
    const html = renderToString(<Slider value={18} unit="%" label="Threshold" valueText="18 percent" />);
    expect(html).toMatch(/^<span class="np-slider" data-component="cpt-noter-component-ui-primitives" data-primitive="slider" data-variant="with-field">/);
    expect(html).toContain('<input type="range" min="0" max="100" step="1" aria-label="Threshold" aria-valuetext="18 percent" value="18"/>');
    expect(html).toContain('<span class="np-field np-field--number" data-primitive="text-field" data-variant="number"><input class="np-field__input np-tnum" type="number" min="0" max="100" step="1" aria-label="Threshold" value="18"/></span>');
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

  it("reports the new value to the owner from the keys and the slider; the field waits for Return or blur", async () => {
    const onAction = vi.fn();
    const { rendered } = await import("../testing");
    const [range, field] = rendered(Slider, { value: 18, onAction }).props.children as ReactElement<Record<string, (e: unknown) => void>>[];
    const preventDefault = vi.fn();
    range.props.onKeyDown({ key: "ArrowRight", shiftKey: true, preventDefault });
    range.props.onKeyDown({ key: "Tab", shiftKey: false, preventDefault });
    expect(onAction).toHaveBeenLastCalledWith(28);
    expect(preventDefault).toHaveBeenCalledOnce();
    range.props.onChange({ target: { value: "40" } });
    expect(onAction).toHaveBeenLastCalledWith(40);
    const input = (field.props.children as unknown as ReactElement<Record<string, (e: unknown) => void>>).props;
    input.onChange({ target: { value: "41" } }); // a draft: nothing is sent while typing
    input.onKeyDown({ key: "Enter" }); // outside a live root the draft state is not kept, so nothing to apply
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});

describe("slider field (cpt-noter-flow-ui-primitives-operate-control)", () => {
  it("applies typed text only when it is a number, clamped to the range", async () => {
    const { fieldValue } = await import("./slider");
    expect(fieldValue("", { min: 0, max: 100 })).toBeNull();
    expect(fieldValue("abc", { min: 0, max: 100 })).toBeNull();
    expect(fieldValue("500", { min: 0, max: 100 })).toBe(100);
    expect(fieldValue("1", { min: 85, max: 150 })).toBe(85);
    expect(fieldValue("42", { min: 0, max: 100 })).toBe(42);
  });
});
