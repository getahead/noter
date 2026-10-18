import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Disclosure } from "./disclosure";

describe("disclosure", () => {
  it("is a button with an expanded state", () => {
    expect(renderToString(<Disclosure label="Details" open={false} />)).toMatch(
      /^<button type="button" class="np-disc np-disc--section" aria-expanded="false" data-component="cpt-noter-component-ui-primitives" data-primitive="disclosure" data-variant="section" data-state="collapsed"><svg class="np-ic np-disc__tri" width="11"[^>]*>.*<\/svg><span>Details<\/span><\/button>$/,
    );
    const open = renderToString(<Disclosure label="Transcript" open variant="row" trailing={<em>3</em>} />);
    expect(open).toContain('class="np-disc np-disc--row is-open" aria-expanded="true"');
    expect(open).toContain('data-state="expanded"');
    expect(open).toContain("<em>3</em></button>");
  });

  it("toggles through the owner", () => {
    const onAction = vi.fn();
    Disclosure({ label: "Details", open: false, onAction }).props.onClick();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
