import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { SegmentView } from "../../core/bindings";
import { TermFixPopover } from "./TermFixPopover";

const segment = { id: "seg1", call_id: "c1", text: "send the notification surface", t0_ms: 0 } as unknown as SegmentView;
const bridge = { core: {}, act: async () => ({ status: "ok", data: { terms: [] } }), store: { setState: () => {} } } as unknown as Bridge;

describe("TermFixPopover", () => {
  it("shows the selected words and keeps Fix disabled until a replacement is typed", () => {
    const html = renderToString(<TermFixPopover bridge={bridge} segment={segment} range={{ start: 9, end: 21 }} anchor={null} onClose={() => {}} onFixed={() => {}} />);
    expect(html).toContain("notification");
    expect(html).toContain("Fix term");
    expect(html).toContain("Add to glossary");
    expect(html).toContain("Older calls get a proposal in Activity");
    expect(html).toContain('data-state="invalid"');
  });
});
