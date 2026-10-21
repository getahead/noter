import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { createWizard } from "../first-run/wizard";
import { ShareTestSheet } from "./ShareTestSheet";

let bridge: Bridge;
afterEach(() => bridge.close());

async function open(seed?: (w: FakeCore["world"]) => void) {
  const fake = new FakeCore({ window: "settings" });
  seed?.(fake.world);
  bridge = createBridge("settings", fake);
  await bridge.open();
  return fake;
}

describe("ShareTestSheet", () => {
  it("shows the table headings, the limits line ending with the hide chord and Done", async () => {
    await open();
    const html = renderToString(<ShareTestSheet bridge={bridge} onClose={() => {}} />);
    expect(html).toContain('aria-label="Screen Share Test"');
    expect(html).toContain("What a share would show");
    for (const h of ["Surface", "Window share", "App share", "Whole display"]) expect(html).toContain(h);
    expect(html).toContain("press ⌃⌥⌘0 to hide Noter.");
    expect(html).toContain("Run Capture Test");
    expect(html).toContain("Done");
  });

  it("disables Run Capture Test during a call and says why", async () => {
    await open((w) => (w.app.capture.phase = "recording"));
    const html = renderToString(<ShareTestSheet bridge={bridge} onClose={() => {}} />);
    expect(html).toContain("Run the test when no call is being recorded.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<span>)?Run Capture Test/);
  });

  it("Done closes the sheet", async () => {
    await open();
    const onClose = vi.fn();
    const done = find(rendered(ShareTestSheet, { bridge, onClose }), (p) => p.label === "Done" || (p.defaultButton as { props?: { label?: string } } | undefined)?.props?.label === "Done");
    ((done.props.defaultButton as { props: { onAction: () => void } }).props.onAction)();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("the controller as the Settings self-test sheet uses it", () => {
  it("starts no model download and no level stream", async () => {
    const fake = await open((w) => (w.app.setup.models.bundles[0]!.state = "pending"));
    const seen: string[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, ...rest: unknown[]) => (seen.push(cmd), (invoke as (...a: unknown[]) => unknown)(cmd, ...rest))) as typeof fake.invoke;
    const stop = createWizard(bridge, () => {}).start({ downloads: false, levels: false });
    await new Promise((r) => setTimeout(r));
    stop();
    expect(seen).not.toContain("models_download");
    expect(seen).not.toContain("levels_subscribe");
  });
});
