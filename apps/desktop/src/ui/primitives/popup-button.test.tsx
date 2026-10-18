import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PopupButton } from "./popup-button";

describe("popup-button", () => {
  it("is a native pop-up with its current value and the prototype's attributes", () => {
    const html = renderToString(<PopupButton options={["1×", "1.5×", "2×"]} value="1.5×" variant="inline" label="Speed" id="speed" />);
    expect(html).toMatch(/^<span class="np-popup np-popup--inline" data-component="cpt-noter-component-ui-primitives" data-primitive="popup-button" data-variant="inline"><select id="speed" aria-label="Speed">/);
    expect(html).toContain('<option value="1.5×" selected="">1.5×</option>');
    expect(html).toContain('class="np-ic np-popup__chev"');
  });

  it("defaults to the form variant, shows disabled choices and the mixed state", () => {
    const html = renderToString(<PopupButton options={[{ value: "a", label: "Anna +1" }, { value: "k", label: "Codex", disabled: true }]} value="a" state="mixed" />);
    expect(html).toContain('data-variant="form" data-state="mixed"');
    expect(html).toContain('<option value="k" disabled="">Codex</option>');
  });

  it("passes the chosen value to the owner; a disabled pop-up is disabled", () => {
    const onAction = vi.fn();
    const select = PopupButton({ options: ["A", "B"], value: "A", onAction }).props.children[0];
    select.props.onChange({ target: { value: "B" } });
    expect(onAction).toHaveBeenCalledWith("B");
    expect(renderToString(<PopupButton options={["A"]} value="A" disabled />)).toContain('disabled=""');
  });
});
