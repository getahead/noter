import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";

import type { Bridge } from "../../app/bridge/bridge";
import type { SegmentView } from "../../core/bindings";
import { rereadSegment, TermFixPopover } from "./TermFixPopover";

const segment = { id: "seg1", call_id: "c1", text: "send the notification surface", t0_ms: 0, lang: "en" } as unknown as SegmentView;
const bridge = { core: {}, act: async () => ({ status: "ok", data: { terms: [] } }), store: { setState: () => {} } } as unknown as Bridge;

describe("TermFixPopover", () => {
  it("prefills Correct term with the selected words in their source language", () => {
    const html = renderToString(<TermFixPopover bridge={bridge} segment={segment} range={{ start: 9, end: 21 }} anchor={null} onClose={() => {}} onFixed={() => {}} />);
    expect(html).toContain("notification");
    expect(html).toContain("Fix term");
    expect(html).toContain("Add to glossary");
    expect(html).toContain("Older calls get a proposal in Activity");
    expect(html).toContain('value="notification"');
    expect(html).toContain('<q lang="en">notification</q>');
    expect(html).toContain('data-state="editing"');
  });
  it("shows the transcript language in a disabled popup without a change handler", () => {
    const tree = rendered(TermFixPopover, { bridge, segment: { ...segment, lang: "ru" }, range: { start: 9, end: 21 }, anchor: null, onClose: () => {}, onFixed: () => {} });
    const popup = find(tree, (pr) => pr.label === "Language").props;
    expect(popup.value).toBe("ru");
    expect(popup.disabled).toBe(true);
    expect(popup.onAction).toBeUndefined();
    expect(popup.options).toEqual(expect.arrayContaining([{ value: "en", label: "English" }, { value: "ru", label: "Russian" }, { value: "de", label: "German" }]));
  });
  it("preserves other transcript languages rather than guessing English", () => {
    const tree = rendered(TermFixPopover, { bridge, segment: { ...segment, lang: { code: "fr" } }, range: { start: 9, end: 21 }, anchor: null, onClose: () => {}, onFixed: () => {} });
    const popup = find(tree, (pr) => pr.label === "Language").props;
    expect(popup.value).toBe("fr");
    expect(popup.options).toContainEqual({ value: "fr", label: "French" });
  });
  it("an empty correction disables Fix and ignores Return", () => {
    const act = vi.fn();
    const tree = rendered(TermFixPopover, { bridge: { ...bridge, act } as Bridge, segment, range: { start: 0, end: 0 }, anchor: null, onClose: () => {}, onFixed: () => {} });
    const fix = find(tree, (pr) => pr.label === "Fix").props;
    expect(fix.disabled).toBe(true);
    (find(tree, (pr) => "onEnter" in pr).props as { onEnter: () => void }).onEnter();
    expect(act).not.toHaveBeenCalled();
  });
  it("rereadSegment puts the core's span lines into the transcript Channel, and ignores a refused read", async () => {
    const writes: unknown[] = [];
    const ok = { core: { transcriptSpan: async () => ({ status: "ok", data: { segments: [{ ...segment, text: "fresh" }] } }) }, store: { setState: (f: unknown) => writes.push(f) } } as unknown as Bridge;
    await rereadSegment(ok, segment);
    expect(writes).toHaveLength(1);
    const refused = { core: { transcriptSpan: async () => ({ status: "error" }) }, store: { setState: (f: unknown) => writes.push(f) } } as unknown as Bridge;
    await rereadSegment(refused, segment);
    expect(writes).toHaveLength(1);
  });
});
