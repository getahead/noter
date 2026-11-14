import { describe, expect, it } from "vitest";

import { LogScroller } from "./follow";

describe("live transcript initial scroll position", () => {
  it("tracks the programmatic end snap so the first upward pixel detaches", () => {
    const log = new LogScroller(32);
    const following = { following: true, base: 0 };
    const area = {
      scrollTop: 0,
      clientHeight: 500,
      scrollHeight: 2_000,
      scrollTo({ top }: { top: number }) {
        this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      },
    };

    log.afterRender(area, { children: [] }, [], following.following, "smooth");
    expect(area.scrollTop).toBe(1_500);

    expect(log.scrolled(following, { ...area, scrollTop: 1_499 }, 0)).toEqual({ following: false, base: 0 });
  });
});
