import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Badge } from "./badge";

describe("badge", () => {
  it("is a status tag by default, with its tone in the variant", () => {
    expect(renderToString(<Badge text="Draft" />)).toBe('<span class="np-badge np-badge--status np-badge--neutral" data-component="cpt-noter-component-ui-primitives" data-primitive="badge" data-variant="status-neutral">Draft</span>');
    expect(renderToString(<Badge text="Failed" tone="error" icon="error" help="The job failed" />)).toContain('data-variant="status-error" title="The job failed"><svg');
  });

  it("is a count pill or a kind tag", () => {
    expect(renderToString(<Badge text="3" kind="count" />)).toContain('class="np-badge np-badge--count np-badge--neutral" data-component="cpt-noter-component-ui-primitives" data-primitive="badge" data-variant="count"');
    expect(renderToString(<Badge text="Decision" kind="kind" cls="x" />)).toContain('class="np-badge np-badge--kind np-badge--neutral x"');
  });
});
