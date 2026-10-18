import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ICONS, Icon, shapes } from "./icons";

// The prototype's glyph table (docs/prototype/clickable/src/js/01-icons.js), read as data.
const source = readFileSync(fileURLToPath(new URL("../../../../docs/prototype/clickable/src/js/01-icons.js", import.meta.url)), "utf8");
const prototype = new Function(`return ${/const P = (\{[\s\S]*?\n {2}\});/.exec(source)![1]}`)() as Record<string, string>;

describe("icons", () => {
  it("carries the prototype's glyphs as-is: same names, same SVG bodies", () => {
    expect(ICONS).toEqual(prototype);
  });

  it("reads every glyph body whole, so no shape is lost in the React port", () => {
    for (const body of Object.values(ICONS)) {
      const rebuilt = shapes(body)
        .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
        .join("");
      expect(rebuilt).toBe(body);
    }
  });

  it("renders the prototype's svg wrapper, decorative unless labelled", () => {
    const html = renderToString(<Icon name="search" size={13} cls="np-search__icon" />);
    expect(html).toMatch(/^<svg class="np-ic np-search__icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">/);
    expect(html).toContain('<circle cx="7" cy="7" r="4.5"');
    expect(html).toContain('<path d="M10.5 10.5L14 14"');
    const labelled = renderToString(<Icon name="mic" label="Microphone" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Microphone"');
    expect(labelled).toContain('width="16"');
    expect(labelled).not.toContain("aria-hidden");
  });

  it("maps hyphenated SVG attributes to React props and falls back to info for an unknown name", () => {
    expect(renderToString(<Icon name="ticket" />)).toContain('stroke-dasharray="1.2 1.4"');
    expect(renderToString(<Icon name={"nope" as never} />)).toBe(renderToString(<Icon name="info" />));
  });
});
