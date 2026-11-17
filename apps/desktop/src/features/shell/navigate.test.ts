import { describe, expect, it, vi } from "vitest";

import { navigate, navigateEffect } from "./navigate";
import { searchRoute } from "./sections";

describe("navigate (in-window routes without a NavTarget)", () => {
  it("pushes the route on the main window's history while the window is mounted", () => {
    const dispatch = vi.fn();
    const release = navigateEffect(dispatch);
    navigate(searchRoute("websocket"));
    expect(dispatch).toHaveBeenCalledWith({ type: "move", move: { type: "push", route: { section: "library", key: "search:websocket" } } });
    release();
    navigate({ section: "topics", key: "topic:top_ws" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a main window, and an old window's release leaves a newer one in place", () => {
    expect(() => navigate({ section: "ask", key: "root" })).not.toThrow();
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = navigateEffect(first);
    navigateEffect(second);
    releaseFirst();
    navigate({ section: "people", key: "person:per_anna" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
