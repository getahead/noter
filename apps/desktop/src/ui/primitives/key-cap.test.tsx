import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeyCap } from "./key-cap";

describe("key-cap", () => {
  it("is a single key or a chord, hidden from VoiceOver", () => {
    expect(renderToString(<KeyCap keys="⌃⌥⌘R" />)).toBe('<kbd data-component="cpt-noter-component-ui-primitives" data-primitive="key-cap" data-variant="chord" class="np-kbd" aria-hidden="true">⌃⌥⌘R</kbd>');
    expect(renderToString(<KeyCap keys="↩" cls="x" />)).toContain('data-variant="single" class="np-kbd x"');
  });
});
