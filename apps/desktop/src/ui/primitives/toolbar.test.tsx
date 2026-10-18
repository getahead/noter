import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Toolbar, ToolbarSpacer } from "./toolbar";

describe("Toolbar (cpt-noter-dod-ui-primitives-controls)", () => {
  it("renders the unified toolbar of 05-shell.js as a labelled toolbar", () => {
    const html = renderToString(<Toolbar region="MW-R1" label="Today"><ToolbarSpacer /></Toolbar>);
    expect(html).toBe('<header class="np-toolbar" data-component="cpt-noter-component-ui-primitives" data-primitive="toolbar" data-region="MW-R1" role="toolbar" aria-label="Today"><span class="np-tb__spacer"></span></header>');
  });
});
