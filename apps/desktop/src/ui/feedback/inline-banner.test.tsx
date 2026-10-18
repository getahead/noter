import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../testing";
import { BannerSlot, InlineBanner, slotView, type Banner } from "./inline-banner";

const b = (id: string, severity: Banner["severity"], extra: Partial<Banner> = {}): Banner => ({ id, severity, text: `${id} text`, ...extra });

describe("InlineBanner (cpt-noter-dod-ui-primitives-feedback)", () => {
  it("renders the prototype's markup: severity icon, title, one sentence and actions", () => {
    const html = renderToString(<InlineBanner banner={b("mic", "error", { title: "No microphone", actions: [{ label: "Open Settings…" }] })} />);
    expect(html).toMatch(/^<div data-component="cpt-noter-component-ui-inline-banner" data-variant="error" data-state="shown" class="np-banner np-banner--error" role="alert">/);
    expect(html).toContain('<span class="np-banner__icon">');
    expect(html).toContain('<div class="np-banner__title">No microphone</div><div class="np-banner__text">mic text</div>');
    expect(html).toContain('class="np-btn np-btn--secondary np-btn--small"');
    expect(html).not.toContain('aria-label="Dismiss"'); // errors cannot be dismissed
  });

  it("info and success take ×, a status role and the compact variant", () => {
    const html = renderToString(<InlineBanner banner={b("ok", "success", { compact: true })} />);
    expect(html).toContain('data-variant="compact-success"');
    expect(html).toContain('class="np-banner np-banner--success is-compact" role="status"');
    expect(html).toContain('aria-label="Dismiss"');
  });

  it("shows progress, the running action's loading state and +N More", () => {
    const html = renderToString(<InlineBanner banner={b("dl", "info", { progress: 64, actions: [{ label: "Cancel", loading: true }] })} more={2} />);
    expect(html).toContain('data-state="working"');
    expect(html).toContain('<div class="np-banner__prog">');
    expect(html).toContain("64 %");
    expect(html).toContain("+2 More");
  });

  it("shows progress text within 0 to 100", () => {
    expect(renderToString(<InlineBanner banner={b("dl", "info", { progress: 140 })} />)).toContain("100 %");
    expect(renderToString(<InlineBanner banner={b("dl", "info", { progress: 33.3333 })} />)).toContain(">33 %<");
  });

  it("a link action renders as a link", () => {
    expect(renderToString(<InlineBanner banner={b("w", "warning", { actions: [{ label: "Learn More", link: true }] })} />)).toContain('class="np-link"');
  });
});

describe("slotView (cpt-noter-flow-ui-primitives-banner)", () => {
  const all = [b("i", "info"), b("e", "error"), b("w", "warning"), b("e2", "error")];

  it("shows the most severe banner and counts the rest, keeping the core's order within a severity", () => {
    const v = slotView(all, new Set(), false);
    expect(v.first?.id).toBe("e");
    expect(v.more).toBe(3);
    expect(v.list).toEqual([]);
  });

  it("+N More lists the waiting banners in place, most severe first", () => {
    const v = slotView(all, new Set(), true);
    expect(v.more).toBe(3); // the button stays, so the list can be closed
    expect(v.list.map((x) => x.id)).toEqual(["e2", "w", "i"]);
  });

  it("a dismissed banner stays hidden; an empty slot shows nothing", () => {
    expect(slotView([b("i", "info")], new Set(["i"]), false)).toEqual({ first: null, more: 0, list: [] });
  });
});

const call = (el: ReactElement, prop: string, ...args: unknown[]) => (el.props as Record<string, (...a: unknown[]) => void>)[prop](...args);

describe("InlineBanner actions", () => {
  it("× and Esc on × dismiss; actions and +N More run the owner's handlers", () => {
    const [onDismiss, onMore, onAction] = [vi.fn(), vi.fn(), vi.fn()];
    const tree = rendered(InlineBanner, { banner: b("i", "info", { actions: [{ label: "Retry", onAction }] }), more: 1, onDismiss, onMore });
    const x = find(tree, (p) => p.label === "Dismiss");
    call(x, "onAction");
    const esc = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    call(x, "onKeyDown", esc);
    expect(esc.stopPropagation).toHaveBeenCalled(); // only the banner goes, not the sheet around it
    call(x, "onKeyDown", { key: "a", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(onDismiss).toHaveBeenCalledTimes(2);
    call(find(tree, (p) => p.label === "+1 More"), "onAction");
    expect(onMore).toHaveBeenCalledOnce();
    call(find(tree, (p) => p.label === "Retry"), "onAction");
    expect(onAction).toHaveBeenCalledOnce();
  });
});

describe("BannerSlot", () => {
  it("renders one banner per slot with +N More in its region", () => {
    const html = renderToString(<BannerSlot region="MW-R5" banners={[b("i", "info"), b("e", "error")]} />);
    expect(html).toMatch(/^<div class="np-bannerslot" data-region="MW-R5">/);
    expect(html.match(/np-banner np-banner--/g)).toHaveLength(1);
    expect(html).toContain("+1 More");
    expect(renderToString(<BannerSlot banners={[]} />)).toBe("");
  });

  it("passes a dismissal on to the owner and wires +N More", () => {
    const onDismiss = vi.fn();
    const tree = rendered(BannerSlot, { banners: [b("i", "info"), b("j", "info")], onDismiss });
    const first = find(tree, (p) => (p.banner as Banner | undefined)?.id === "i");
    call(first, "onDismiss");
    expect(onDismiss).toHaveBeenCalledWith("i");
    call(first, "onMore"); // a state update outside a live root is a no-op; slotView covers the list
  });
});
