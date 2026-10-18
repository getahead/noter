import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Progress } from "./progress";

describe("progress", () => {
  it("is a progress bar with value text", () => {
    expect(renderToString(<Progress value={64} label="Indexing" />)).toBe(
      '<span class="np-progress" role="progressbar" data-component="cpt-noter-component-ui-primitives" data-primitive="progress" data-variant="determinate" data-state="running" aria-valuenow="64" aria-valuemin="0" aria-valuemax="100" aria-label="Indexing" aria-valuetext="64 percent"><span class="np-progress__fill" style="width:64%"></span></span>',
    );
    expect(renderToString(<Progress value={140} />)).toContain("width:100%");
  });

  it("is indeterminate without a value, and a row spinner", () => {
    const ind = renderToString(<Progress state="paused" />);
    expect(ind).toContain('class="np-progress is-ind"');
    expect(ind).toContain('data-variant="indeterminate" data-state="paused"');
    expect(ind).not.toContain("aria-valuenow");
    expect(ind).toContain("width:40%");
    expect(renderToString(<Progress variant="spinner" />)).toBe('<span class="np-spin" role="progressbar" aria-label="Working" data-component="cpt-noter-component-ui-primitives" data-primitive="progress" data-variant="spinner" data-state="running"></span>');
  });
});
