import { describe, expect, it } from "vitest";
import { orderBanners, pruneDismissed, restoreDismissed, visibleBanners, type Severity } from "./banners";

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

describe("restoreDismissed", () => {
  it("takes back a dismissal the owner's command refused, and leaves the set alone when it held none", () => {
    const held = new Set(["update_ready", "roll_up_failed"]);
    expect([...restoreDismissed(held, "update_ready")]).toEqual(["roll_up_failed"]);
    expect(held.has("update_ready")).toBe(true); // the old set is not changed
    expect(restoreDismissed(held, "other")).toBe(held);
  });
});
