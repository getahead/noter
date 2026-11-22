import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FakeCore } from "../core/fake/fake-core";
import { createBridge } from "./bridge/bridge";
import { WindowBoundary } from "./WindowBoundary";

// #1036: one failed render or effect keeps the window with the window-error banner and logs the error
describe("WindowBoundary (cpt-noter-flow-ui-core-bridge-open-window)", () => {
  it("keeps the window with the error banner and Try Again, logs the error, and Try Again renders the window again", () => {
    const fake = new FakeCore({ window: "call-screen" });
    const bridge = createBridge("call-screen", fake);
    const logUi = vi.spyOn(bridge.core, "logUi");
    const boundary = new WindowBoundary({ bridge, children: <p>window body</p> });
    expect(renderToString(boundary.render())).toContain("window body");

    const error = new ReferenceError("live is not defined");
    boundary.state = WindowBoundary.getDerivedStateFromError();
    boundary.componentDidCatch(error);
    const html = renderToString(boundary.render());
    expect(html).toContain('data-window="call-screen"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try Again");
    expect(html).not.toContain("window body");
    expect(logUi).toHaveBeenCalledWith({ level: "error", screen: "call-screen", code: null, message: "ReferenceError: live is not defined" });

    boundary.setState = (next) => void (boundary.state = { ...boundary.state, ...(next as object) });
    boundary.retry();
    expect(renderToString(boundary.render())).toContain("window body");
  });
});
