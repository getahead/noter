import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeProvider, useBridge } from "../../app/bridge/context";
import { DialogsProvider } from "../../ui/dialogs/host";
import { heldFilter, holdFilter, BLANK } from "./filters";
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
  it("starts in LOADING under the bridge and dialogs providers: the filter bar, no rows yet", () => {
    vi.stubGlobal("document", { hasFocus: () => true });
    const h = renderToString(
      <BridgeProvider value={bridge}>
        <DialogsProvider>
          <CallsPage />
        </DialogsProvider>
      </BridgeProvider>,
    );
    expect(h).toContain('data-region="LC-R2"');
    expect(h).toContain('data-region="LC-R3"');
    expect(h).not.toContain("lb-crow");
  });
});

describe("CallsPage filters (cpt-noter-flow-ui-library-search-topics-filter-tag)", () => {
  it("a filter action is held for Back and read again, Clear drops it, words alone read nothing", () => {
    vi.stubGlobal("document", { hasFocus: () => true, querySelector: () => null });
    holdFilter(BLANK);
    const act = vi.fn(() => new Promise(() => {}));
    let out: never = null as never;
    const Probe = () => ((out = CallsPage() as never), null);
    renderToString(
      <BridgeProvider value={{ ...(bridge as object), act } as never}>
        <DialogsProvider>
          <Probe />
        </DialogsProvider>
      </BridgeProvider>,
    );
    const view = out as { props: { bar: { props: { onAction: (a: unknown) => void } }; onClearFilters: () => void; onAddTag: () => void } };
    const before = act.mock.calls.length;
    view.props.bar.props.onAction({ type: "words", words: "x" });
    expect(act.mock.calls.length).toBe(before);
    view.props.bar.props.onAction({ type: "open_items", on: true });
    expect(heldFilter().filter.has_open_items).toBe(true);
    // the read itself goes through the filter watcher (an effect), one per change: syncFilter's test counts it
    view.props.onClearFilters();
    expect(heldFilter().filter).toEqual({});
    view.props.onAddTag();
    holdFilter(BLANK);
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

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
