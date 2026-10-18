import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buttonState, press, PushButton } from "./push-button";

describe("push-button", () => {
  it("renders the prototype's markup and attributes for its variant and size", () => {
    expect(renderToString(<PushButton label="Record" variant="primary" icon="record" kbd="⌘R" />)).toBe(
      '<button type="button" class="np-btn np-btn--primary np-btn--regular" data-component="cpt-noter-component-ui-primitives" data-primitive="push-button" data-variant="primary" data-size="regular">' +
        '<svg class="np-ic" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="currentColor" stroke="none"></circle></svg>' +
        '<span>Record</span><kbd data-component="cpt-noter-component-ui-primitives" data-primitive="key-cap" data-variant="chord" class="np-kbd" aria-hidden="true">⌘R</kbd></button>',
    );
    const small = renderToString(<PushButton label="Not Now" size="small" icon="x" submit region="RP-R2" shortcut="Escape" chevron expanded={false} />);
    expect(small).toContain('type="submit" class="np-btn np-btn--secondary np-btn--small"');
    expect(small).toContain('data-size="small" data-region="RP-R2"');
    expect(small).toContain('width="12"');
    expect(small).toContain('aria-keyshortcuts="Escape"');
    expect(small).toContain('aria-expanded="false"');
    expect(small).toContain('class="np-ic np-btn__chev"');
  });

  it("is a button whose role and name are its visible text", () => {
    const html = renderToString(<PushButton label="Save" ariaLabel="Save the summary" />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-label="Save the summary"');
  });

  it("keeps a disabled reason as its help tag and takes no action", () => {
    const html = renderToString(<PushButton label="Record" disabled help="Free up 500 MB to record" />);
    expect(html).toContain('data-state="disabled"');
    expect(html).toContain('title="Free up 500 MB to record"');
    expect(html).toContain('disabled=""');
    const onAction = vi.fn();
    PushButton({ label: "Record", disabled: true, onAction }).props.onClick();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("shows a spinner in place of the icon while loading, keeps the label and ignores a second press", () => {
    const html = renderToString(<PushButton label="Retry" icon="refresh" loading />);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain('<span class="np-spin" aria-hidden="true"></span><span>Retry</span>');
    expect(html).not.toContain("<svg");
    const onAction = vi.fn();
    PushButton({ label: "Retry", loading: true, onAction }).props.onClick();
    expect(onAction).not.toHaveBeenCalled();
  });

  it("runs the owner's handler on a press (click, Space or Return on a native button)", () => {
    const onAction = vi.fn();
    PushButton({ label: "Copy", onAction }).props.onClick();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(() => press({})).not.toThrow();
  });

  it("follows the push-button states: loading and disabled from the owner, otherwise the pinned state", () => {
    expect(buttonState({ loading: true, disabled: true })).toBe("loading");
    expect(buttonState({ disabled: true, state: "hover" })).toBe("disabled");
    expect(buttonState({ state: "pressed" })).toBe("pressed");
    expect(buttonState({})).toBeUndefined();
  });

  it("reads the inline status on its label while the owner sets it", () => {
    const html = renderToString(<PushButton label="Copy" flash="Copied" />);
    expect(html).toContain('<span class="np-btn__flash"><svg');
    expect(html).toContain("Copied</span>");
    expect(html).not.toContain("<span>Copy</span>");
  });
});
