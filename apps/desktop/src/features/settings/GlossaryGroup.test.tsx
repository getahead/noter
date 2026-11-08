import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { GlossaryTerm } from "../../core/bindings";
import { TermRows } from "./GlossaryGroup";

const term = (id: string): GlossaryTerm => ({ id, term: id, variants_latin: [], variants_cyrillic: [], spoken_forms: [] }) as unknown as GlossaryTerm;
const stops = (html: string) => [...html.matchAll(/<tr[^>]*tabindex="(-?\d)"/g)].map((m) => m[1]);

describe("Glossary rows (one Tab stop)", () => {
  const terms = [term("a"), term("b"), term("c")];
  const render = (selected: string | null) => renderToString(<table><tbody><TermRows terms={terms} selected={selected} onSelect={() => {}} /></tbody></table>);

  it("the first term carries the stop while none is selected", () => expect(stops(render(null))).toEqual(["0", "-1", "-1"]));
  it("the selected term carries it", () => expect(stops(render("c"))).toEqual(["-1", "-1", "0"]));
});
