import { describe, expect, it } from "vitest";

import { LogScroller } from "./follow";

describe("live transcript initial scroll position", () => {
  it("preserves an upward pixel when a render precedes its native scroll event", () => {
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
    log.afterRender(area, { children: [] }, [], true, "smooth");
    area.scrollTop -= 1; // the wheel moved before the browser delivered scroll
    log.afterRender(area, { children: [] }, [], true, "smooth");
    expect(area.scrollTop).toBe(1_499);
    expect(log.scrolled(following, area, 0)).toEqual({ following: false, base: 0 });
  });

  it("keeps the pending upward pixel through a measured row correction", () => {
    const log = new LogScroller(32);
    const following = { following: true, base: 0 };
    const area = {
      scrollTop: 1_499,
      clientHeight: 500,
      scrollHeight: 2_002,
      scrollTo({ top }: { top: number }) {
        this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      },
    };
    log.prevTop = 1_500;
    const keys = Array.from({ length: 60 }, (_, i) => String(i));
    const rows = { children: [{ offsetHeight: 34, offsetTop: 0 }] };
    log.afterRender(area, rows, keys, true, "smooth");
    expect(log.scrolled(following, area, 0)).toEqual({ following: false, base: 0 });
  });

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

describe("live transcript detachment", () => {
  it("keeps a detached upward pixel through duplicate native scroll events", () => {
    const log = new LogScroller(32);
    log.prevTop = 1_500;
    const position = { scrollTop: 1_499, clientHeight: 500, scrollHeight: 2_000 };
    const detached = log.scrolled({ following: true, base: 0 }, position, 7);
    expect(detached).toEqual({ following: false, base: 7 });
    expect(log.scrolled(detached, position, 8)).toBe(detached);
    expect(log.scrolled(detached, { ...position, scrollTop: 1_500 }, 8)).toEqual({ following: true, base: 8 });
  });
});
