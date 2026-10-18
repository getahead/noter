import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { FakeCore } from "../core/fake/fake-core";
import { App } from "./App";
import { createBridge, type Bridge } from "./bridge/bridge";

let bridge: Bridge | null = null;
afterEach(async () => {
  await bridge?.close();
  bridge = null;
});

describe("App", () => {
  it("renders the window's state from its store", async () => {
    bridge = createBridge("main", new FakeCore({ window: "main" }));
    expect(renderToString(<App bridge={bridge} />)).toContain('data-state="empty"');
    await bridge.open();
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('data-window="main"');
    expect(html).toContain('data-state="ready"');
    expect(html).not.toContain("Try Again");
    expect(html).toContain('data-live="polite"');
    expect(html).toContain('data-live="assertive"');
  });

  it("shows the section-level error with Try Again only when retryable", async () => {
    const fake = new FakeCore({ window: "settings" });
    bridge = createBridge("settings", fake);
    fake.failNext("app_snapshot", "offline");
    await bridge.open();
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try Again");
    fake.failNext("app_snapshot", "not_found");
    await bridge.open();
    expect(renderToString(<App bridge={bridge} />)).not.toContain("Try Again");
  });
});
