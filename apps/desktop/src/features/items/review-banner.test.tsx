import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { resetUndo } from "../history/undo";
import { resetLocal } from "./local";
import { startReview, useReviewBanner } from "./review-banner";
import { loadItems } from "./actions";
import { CallBanners } from "../call-page/CallBanners";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(() => (resetLocal(), resetUndo()));
afterEach(() => {
  vi.unstubAllGlobals();
  return bridge.close();
});
async function ready() {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
}
/** The banner the hook returns for `callId` (the hook runs inside a render). */
function bannerOf(callId: string) {
  let out: ReturnType<typeof useReviewBanner> = null;
  const Grab = () => ((out = useReviewBanner(bridge, callId)), null);
  renderToString(<Grab />);
  return out as ReturnType<typeof useReviewBanner>;
}

describe("review banner (PC-R2)", () => {
  it("is absent with nothing to review: no banner, no Accept All", async () => {
    await ready();
    expect(bannerOf("call_backend")).toBeNull();
  });

  it("counts the call's suggested items once they are in the store, with Start Review and Accept All", async () => {
    await ready();
    await loadItems(bridge, "call_live");
    const banner = bannerOf("call_live")!;
    expect(banner).toMatchObject({ id: "review", severity: "info", dismissible: false, text: "3 suggested items to review before sharing" });
    const actions = banner.actions!;
    expect(actions.map((a) => a.label)).toEqual(["Start Review", "Accept All"]);
    const seen: string[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((c: string, a: unknown) => (seen.push(c), (invoke as (...x: unknown[]) => unknown)(c, a))) as typeof fake.invoke;
    actions[1]!.onAction?.();
    await new Promise((r) => setTimeout(r));
    expect(seen).toContain("items_review_all");
  });

  it("a call page without suggestions draws no banner slot", async () => {
    await ready();
    const id = fake.world.calls.find((c) => c.id === "call_backend")!.id;
    expect(renderToString(<CallBanners route={{ section: "library", key: `call:${id}:summary` } as never} bridge={bridge} appBanners={0} />)).toBe("");
  });

  it("Start Review focuses the first suggested row on the page", () => {
    const focus = vi.fn();
    vi.stubGlobal("document", { querySelector: (sel: string) => (sel.includes('data-review="suggested"') ? { focus } : null) });
    expect(startReview()).toBe(true);
    expect(focus).toHaveBeenCalled();
    vi.stubGlobal("document", { querySelector: () => null });
    expect(startReview()).toBe(false);
  });
});
