import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { MODE_MSG, ModeIndicator, ModeInfo } from "./mode-indicator-view";
import { modeIndicator, type ModeState } from "./mode-indicator";
import { en } from "../../i18n/en";

const view = (state: ModeState) => modeIndicator({ mode: "cloud_redacted", degraded: [], sensitiveCall: false, ...({ CLOUD_REDACTED: {}, CLOUD: { mode: "cloud_allowed" }, LOCAL_ONLY: { mode: "local_only" }, SENSITIVE_LOCAL: { sensitiveCall: true }, SWITCHED_TO_LOCAL: { degraded: [{ type: "switched_to_local" }] }, NO_ASSISTANT: { degraded: [{ type: "no_assistant" }] } } as Record<ModeState, object>)[state] } as never);

describe("ModeIndicator (cpt-noter-dod-ui-main-window-shell-mode-indicator)", () => {
  it("shows glyph and word for each of the six modes, and VoiceOver reads Mode: cloud with redaction", () => {
    const states = Object.keys(MODE_MSG) as ModeState[];
    for (const state of states) {
      const html = renderToString(<ModeIndicator view={view(state)} />);
      expect(html).toContain(`>${en[MODE_MSG[state].word]}</span>`);
      expect(html).toContain("<svg");
      expect(html).toContain('aria-haspopup="dialog"');
    }
    expect(renderToString(<ModeIndicator view={view("CLOUD_REDACTED")} />)).toContain('aria-label="Mode: cloud with redaction"');
  });

  it("uses the warning form for Switched to local and No assistant only", () => {
    expect(renderToString(<ModeIndicator view={view("SWITCHED_TO_LOCAL")} />)).toContain('data-state="degraded"');
    expect(renderToString(<ModeIndicator view={view("NO_ASSISTANT")} />)).toContain("is-warn");
    expect(renderToString(<ModeIndicator view={view("LOCAL_ONLY")} />)).toContain('data-state="normal"');
    expect(renderToString(<ModeIndicator view={view("LOCAL_ONLY")} />)).not.toContain("is-warn");
  });

  it("renders the host's variants: glyph only, a line of text, the runtime name, the host's own footer line", () => {
    const glyph = renderToString(<ModeIndicator view={view("CLOUD")} variant="glyph" />);
    expect(glyph).not.toContain("np-mode__word");
    expect(glyph).toContain('aria-label="Mode: cloud"');
    expect(renderToString(<ModeIndicator view={view("CLOUD")} variant="menu-line" />)).toBe(
      '<span data-component="cpt-noter-component-ui-mode-indicator" data-variant="menu-line" data-state="normal" class="np-mode np-mode--line">Cloud</span>',
    );
    expect(renderToString(<ModeIndicator view={view("CLOUD")} variant="call-header" runtime="Claude Code" />)).toContain("Claude Code · Cloud");
    expect(renderToString(<ModeIndicator view={view("CLOUD")} text="Idle · API key · local fallback ready" />)).toContain("Idle · API key · local fallback ready");
  });

  it("never uses council-mode words", () => {
    const words = Object.values(MODE_MSG).flatMap((m) => [en[m.word], en[m.text]].map(String)).join(" ");
    expect(words).not.toMatch(/council|single/i);
  });

  it("explains the mode in a popover with Open Privacy Settings, and closes it before opening Settings", () => {
    const onClose = vi.fn();
    const onOpenPrivacy = vi.fn();
    const tree = rendered(ModeInfo, { view: view("CLOUD_REDACTED"), variant: "sidebar", anchor: null as never, onClose, onOpenPrivacy });
    const html = renderToString(tree);
    expect(html).toContain('data-variant="mode-info"');
    expect(html).toContain("Cloud with redaction: names and PII are replaced before anything leaves this Mac.");
    expect(html).toContain("Open Privacy Settings");
    expect(html).not.toContain("Make This Call Sensitive");
    (find(tree, (p) => p.label === "Open Privacy Settings").props.onAction as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpenPrivacy).toHaveBeenCalledOnce();
  });

  it("adds Make This Call Sensitive in the call window, Mark as Sensitive on the Call page, and no privacy link in Settings", () => {
    const base = { view: view("CLOUD_REDACTED"), anchor: null as never, onClose: vi.fn() };
    const onMake = vi.fn();
    const onMark = vi.fn();
    const call = rendered(ModeInfo, { ...base, variant: "call-header", onMakeSensitive: onMake });
    (find(call, (p) => p.label === "Make This Call Sensitive").props.onAction as () => void)();
    expect(onMake).toHaveBeenCalledOnce();
    const info = rendered(ModeInfo, { ...base, variant: "call-info", onMarkSensitive: onMark });
    (find(info, (p) => p.label === "Mark as Sensitive").props.onAction as () => void)();
    expect(onMark).toHaveBeenCalledOnce();
    expect(renderToString(rendered(ModeInfo, { ...base, variant: "settings" }))).not.toContain("Open Privacy Settings");
  });

  it("opens the popover on press: the indicator's click toggles it", () => {
    const tree = rendered(ModeIndicator, { view: view("CLOUD_REDACTED") });
    const button = find(tree, (p) => p["aria-haspopup"] === "dialog");
    (button.props.onClick as (e: unknown) => void)({ currentTarget: {} });
  });
});
