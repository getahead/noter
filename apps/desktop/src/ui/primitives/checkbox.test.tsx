import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

describe("checkbox", () => {
  it("is a native checkbox inside its label, off, on or mixed", () => {
    expect(renderToString(<Checkbox label="Send the spec" checked={false} id="c1" />)).toBe(
      '<label class="np-check" data-component="cpt-noter-component-ui-primitives" data-primitive="checkbox" data-variant="single" data-state="off"><input type="checkbox" id="c1"/><span class="np-check__box" aria-hidden="true"></span><span class="np-check__label">Send the spec</span></label>',
    );
    expect(renderToString(<Checkbox label="Done" checked />)).toContain('data-state="on"><input type="checkbox" checked=""/><span class="np-check__box" aria-hidden="true"><svg');
    const mixed = renderToString(<Checkbox ariaLabel="All rows" checked={false} mixed variant="mixed" />);
    expect(mixed).toContain('data-variant="mixed" data-state="mixed"');
    expect(mixed).toContain('aria-label="All rows" aria-checked="mixed"');
  });

  it("is dimmed and disabled with its reason as help tag, and reports a change to the owner", () => {
    const html = renderToString(<Checkbox label="Notify" checked disabled help="Notifications are off in macOS" />);
    expect(html).toContain('class="np-check is-disabled"');
    expect(html).toContain('title="Notifications are off in macOS"');
    expect(html).toContain('disabled=""');
    const onAction = vi.fn();
    Checkbox({ label: "Notify", checked: false, onAction }).props.children[0].props.onChange({ target: { checked: true } });
    expect(onAction).toHaveBeenCalledWith(true);
  });
});
