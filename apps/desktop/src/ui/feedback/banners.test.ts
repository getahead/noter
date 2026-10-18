import { describe, expect, it } from "vitest";
import { bannerNext, orderBanners, pruneDismissed, visibleBanners, type BannerState, type Severity } from "./banners";

const b = (id: string, severity: Severity) => ({ id, severity });

describe("orderBanners (cpt-noter-algo-ui-primitives-order-banners)", () => {
  it("shows the most severe banner first and counts the others for +N More", () => {
    const { first, rest, more } = orderBanners([b("s", "success"), b("i", "info"), b("d", "degraded"), b("w", "warning"), b("e", "error")]);
    expect(first?.id).toBe("e");
    expect(rest.map((x) => x.id)).toEqual(["w", "d", "i", "s"]);
    expect(more).toBe(4);
  });

  it("keeps the core's order within one severity and leaves the input as it was", () => {
    const input = [b("w1", "warning"), b("e1", "error"), b("w2", "warning"), b("e2", "error"), b("w3", "warning")];
    const { first, rest } = orderBanners(input);
    expect([first, ...rest].map((x) => x?.id)).toEqual(["e1", "e2", "w1", "w2", "w3"]);
    expect(input[0].id).toBe("w1");
  });

  it("returns an empty slot for no banners and no More for one", () => {
    expect(orderBanners([])).toEqual({ first: null, rest: [], more: 0 });
    expect(orderBanners([b("i", "info")]).more).toBe(0);
  });
});

describe("dismissal", () => {
  it("hides a dismissed banner while its event lasts", () => {
    expect(visibleBanners([b("a", "info"), b("b", "success")], new Set(["a"])).map((x) => x.id)).toEqual(["b"]);
  });

  it("forgets a dismissal once the banner leaves, so it shows again when the event happens again", () => {
    const dismissed = new Set(["a", "gone"]);
    expect([...pruneDismissed(dismissed, [b("a", "info")])]).toEqual(["a"]);
    expect(pruneDismissed(dismissed, [b("a", "info"), b("gone", "info")])).toBe(dismissed);
  });
});

describe("bannerNext (cpt-noter-state-ui-primitives-inline-banner)", () => {
  const cases: [BannerState, Parameters<typeof bannerNext>[1], BannerState][] = [
    ["SHOWN", "action", "WORKING"],
    ["WORKING", "failed", "SHOWN"],
    ["SHOWN", "more", "STACKED"],
    ["STACKED", "less", "SHOWN"],
    ["SHOWN", "dismiss", "DISMISSED"],
    ["SHOWN", "resolved", "RESOLVED"],
    ["WORKING", "resolved", "RESOLVED"],
  ];
  it.each(cases)("goes from %s on %s to %s", (from, event, to) => {
    expect(bannerNext(from, event, true)).toBe(to);
  });

  it("keeps a banner that cannot be dismissed (warning, error, degraded)", () => {
    expect(bannerNext("SHOWN", "dismiss", false)).toBe("SHOWN");
  });

  it("ignores events that are not transitions of the current state", () => {
    expect(bannerNext("WORKING", "action", true)).toBe("WORKING");
    expect(bannerNext("WORKING", "dismiss", true)).toBe("WORKING");
    expect(bannerNext("DISMISSED", "more", true)).toBe("DISMISSED");
    expect(bannerNext("RESOLVED", "failed", true)).toBe("RESOLVED");
  });
});
