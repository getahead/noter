import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Link } from "./link";

describe("link", () => {
  it("is a link, inline or external with ↗", () => {
    expect(renderToString(<Link label="Finish Setup…" />)).toBe('<a href="#" class="np-link" data-component="cpt-noter-component-ui-primitives" data-primitive="link" data-variant="inline">Finish Setup…</a>');
    const ext = renderToString(<Link label="VSTOR-123" href="https://jira.example/VSTOR-123" external icon="ticket" ariaLabel="VSTOR-123, opens in Jira" lang="en" />);
    expect(ext).toContain('href="https://jira.example/VSTOR-123" class="np-link" data-component="cpt-noter-component-ui-primitives" data-primitive="link" data-variant="external" aria-label="VSTOR-123, opens in Jira" lang="en"><svg');
    expect(ext).toContain('VSTOR-123<span class="np-link__ext" aria-hidden="true">↗</span></a>');
  });

  it("runs the owner's handler instead of following the href", () => {
    const onAction = vi.fn();
    const preventDefault = vi.fn();
    Link({ label: "Open", onAction }).props.onClick({ preventDefault });
    expect(onAction).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(Link({ label: "Open" }).props.onClick).toBeUndefined();
  });
});
