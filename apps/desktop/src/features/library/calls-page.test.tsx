import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BridgeProvider, useBridge } from "../../app/bridge/context";
import { DialogsProvider } from "../../ui/dialogs/host";
import { CallsPage } from "./calls-page";

const bridge = {
  label: "main",
  store: {
    getState: () => ({
      entities: { call: {} },
      outputs: {},
      whole: { setup: { self_test: { type: "skipped" } } },
    }),
    subscribe: () => () => {},
  },
  act: () => new Promise(() => {}),
  core: {},
} as never;

describe("CallsPage (cpt-noter-state-ui-library-calls-list)", () => {
  it("starts in LOADING under the bridge and dialogs providers: the header, no rows yet", () => {
    vi.stubGlobal("document", { hasFocus: () => true });
    const h = renderToString(
      <BridgeProvider value={bridge}>
        <DialogsProvider>
          <CallsPage />
        </DialogsProvider>
      </BridgeProvider>,
    );
    expect(h).toContain('data-region="LC-R1"');
    expect(h).toContain('data-region="LC-R3"');
    expect(h).not.toContain("lb-crow");
  });
});

describe("useBridge", () => {
  it("gives the provided bridge and refuses to run without one", () => {
    let got: unknown;
    const Probe = () => ((got = useBridge()), null);
    renderToString(
      <BridgeProvider value={bridge}>
        <Probe />
      </BridgeProvider>,
    );
    expect(got).toBe(bridge);
    expect(() => renderToString(<Probe />)).toThrow("BridgeProvider");
  });
});
