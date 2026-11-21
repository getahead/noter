import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Bridge } from "../../app/bridge/bridge";
import { find, rendered } from "../testing";
import { ModelDownloadNotice } from "./model-download-notice";

describe("optional model degradation (cpt-noter-dod-ui-first-run-models)", () => {
  it("names the missing feature and opens its model download in Settings", () => {
    const navigate = vi.fn();
    const bridge = { store: createStore(() => ({ whole: { setup: { models: { bundles: [{ name: "bge-m3", state: "pending" }] } } } })),
      act: vi.fn((_key, _command, run) => run()), core: { windowNavigate: navigate } } as unknown as Bridge;
    const props = { bridge, model: "bge-m3" as const };
    expect(renderToString(<ModelDownloadNotice {...props} />)).toContain("keyword search");
    const banner = find(rendered(ModelDownloadNotice, props), (p) => p.banner !== undefined).props.banner as { actions: { onAction: () => void }[] };
    banner.actions[0]!.onAction();
    expect(navigate).toHaveBeenCalledWith({ target: { type: "settings", pane: "models_and_runtimes" } });
  });
  it("does not show a notice for an installed model or a snapshot without models", () => {
    for (const bundles of [[], [{ name: "wespeaker", state: "ready" }]]) {
      const bridge = { store: createStore(() => ({ whole: { setup: { models: { bundles } } } })) } as unknown as Bridge;
      expect(renderToString(<ModelDownloadNotice bridge={bridge} model="wespeaker" />)).toBe("");
    }
  });
});
