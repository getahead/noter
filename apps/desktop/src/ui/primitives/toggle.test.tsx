import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Toggle } from "./toggle";

describe("toggle", () => {
  it("is a switch with the label before it, regular or small", () => {
    expect(renderToString(<Toggle label="Talk time" on />)).toBe(
      '<label class="np-toggle np-toggle--regular" data-component="cpt-noter-component-ui-primitives" data-primitive="toggle" data-size="regular" data-state="on"><span class="np-toggle__label">Talk time</span><input type="checkbox" role="switch" checked=""/><span class="np-toggle__track" aria-hidden="true"><span class="np-toggle__thumb"></span></span></label>',
    );
    const small = renderToString(<Toggle label="Live" on={false} size="small" labelAfter disabled />);
    expect(small).toContain('class="np-toggle np-toggle--small is-disabled"');
    expect(small).toContain('data-size="small" data-state="off"');
    expect(small).toMatch(/np-toggle__thumb"><\/span><\/span><span class="np-toggle__label">Live<\/span><\/label>$/);
    expect(renderToString(<Toggle ariaLabel="Agent" on={false} />)).toContain('aria-label="Agent"');
  });

  it("reports the new value to the owner", () => {
    const onAction = vi.fn();
    Toggle({ on: false, onAction }).props.children[1].props.onChange({ target: { checked: true } });
    expect(onAction).toHaveBeenCalledWith(true);
  });
});
