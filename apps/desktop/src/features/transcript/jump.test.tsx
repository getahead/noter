// ⌘J in the live transcript (#1154): the view's own wiring of LogScroller.toEnd and arrived().
import { describe, expect, it, vi } from "vitest";

import type { ShortcutTable } from "../../app/a11y/keys";
import { find, rendered } from "../../ui/testing";
import { buildRows } from "./model";
import { seg } from "./testing";
import { TranscriptView } from "./transcript-view";

const tables: ShortcutTable[] = [];
vi.mock("../../app/a11y/keys", async (original) => ({
  ...(await original<typeof import("../../app/a11y/keys")>()),
  useWindowShortcuts: (table: ShortcutTable) => void tables.push(table),
}));

describe("TranscriptView ⌘J (#1154)", () => {
  it("asks for a smooth scroll to the end on every ⌘J, and a scroll that reaches the end lets the next ask through", () => {
    const rows = buildRows({ segments: [seg("a", 0), seg("b", 5000)], hypotheses: [], gaps: [], marks: [] }, "live");
    const tree = rendered(TranscriptView, { variant: "live", rows, speakers: [], loaded: true });
    const scroller = find(tree, (p) => p.className === "cw-tv__scroll");
    const area = { scrollTop: 0, clientHeight: 100, scrollHeight: 1000, scrollTo: vi.fn() };
    (scroller.props.ref as { current: unknown }).current = area;
    const jump = tables.at(-1)!["Meta+KeyJ"]!;

    jump();
    jump(); // a second ⌘J is the user asking again, never skipped
    expect(area.scrollTo).toHaveBeenCalledTimes(2);
    expect(area.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "smooth" });

    area.scrollTop = 900; // the scroll arrived at the end
    expect(() => (scroller.props.onScroll as () => void)()).not.toThrow();
  });
});
