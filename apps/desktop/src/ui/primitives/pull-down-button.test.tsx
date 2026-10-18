import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { opensMenu, PullDownButton } from "./pull-down-button";

describe("pull-down-button", () => {
  it("is a menu button built from a push button with a chevron", () => {
    const html = renderToString(<PullDownButton label="Share" />);
    expect(html).toContain('class="np-btn np-btn--secondary np-btn--regular"');
    expect(html).toContain('data-primitive="pull-down-button" data-variant="toolbar" data-size="regular"');
    expect(html).toContain('aria-expanded="false" aria-haspopup="menu"');
    expect(html).toContain("np-btn__chev");
    expect(renderToString(<PullDownButton label="Not Now" variant="panel" size="small" open />)).toContain('data-variant="panel" data-size="small" aria-expanded="true"');
  });

  it("is an icon button (⋯) whose label names the menu", () => {
    const html = renderToString(<PullDownButton label="More" iconOnly ariaLabel="More actions for Standup" help="More" />);
    expect(html).toContain('class="np-ibtn np-ibtn--inline"');
    expect(html).toContain('data-primitive="pull-down-button" data-variant="item-menu" data-size="inline" title="More"');
    expect(html).toContain('aria-label="More actions for Standup"');
    expect(html).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(renderToString(<PullDownButton label="Mute" iconOnly icon="mute" size="toolbar" open />)).toContain('np-ibtn--toolbar');
  });

  it("opens on Space (a press) or ↓, and ↓ does nothing while open or disabled", () => {
    expect(opensMenu("ArrowDown")).toBe(true);
    expect(opensMenu("ArrowDown", true)).toBe(false);
    expect(opensMenu("Enter")).toBe(false);
    for (const iconOnly of [false, true]) {
      const onAction = vi.fn();
      const el = PullDownButton({ label: "Share", iconOnly, onAction });
      const preventDefault = vi.fn();
      el.props.onKeyDown({ key: "ArrowDown", preventDefault });
      el.props.onKeyDown({ key: "ArrowUp", preventDefault });
      expect(onAction).toHaveBeenCalledOnce();
      expect(preventDefault).toHaveBeenCalledOnce();
      PullDownButton({ label: "Share", iconOnly, disabled: true, onAction }).props.onKeyDown({ key: "ArrowDown", preventDefault });
      expect(onAction).toHaveBeenCalledOnce();
    }
  });
});
