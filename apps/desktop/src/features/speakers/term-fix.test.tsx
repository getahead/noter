import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { find, rendered } from "../../ui/testing";

import type { Bridge } from "../../app/bridge/bridge";
import type { SegmentView } from "../../core/bindings";
import { TermFixPopover } from "./TermFixPopover";

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
  it("the controls take input; Fix stays inert with nothing typed", () => {
    const tree = rendered(TermFixPopover, { bridge, segment, range: { start: 0, end: 0 }, anchor: null, onClose: () => {}, onFixed: () => {} });
    (find(tree, (pr) => "onEnter" in pr).props as { onChange: (v: string) => void; onEnter: () => void }).onChange("notifier");
    (find(tree, (pr) => "onEnter" in pr).props as { onEnter: () => void }).onEnter();
    (find(tree, (pr) => pr.label === "Add to glossary").props as { onAction: (v: boolean) => void }).onAction(false);
    (find(tree, (pr) => pr.label === "Fix").props as { onAction: () => void }).onAction();
  });
});
