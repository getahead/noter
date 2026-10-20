// Performance scenario `ui_shell_render` (harness/perf.toml, docs/ADR/0003): the startup render of the main window
// (sidebar, toolbar, banner slot, page) from a READY store filled from the fixture world, then a ⌘1 to ⌘8 section
// switch each round. Component cost only: no layout or paint, which only the Mac can measure.
// Deterministic: fixed workload, no clock, no randomness. Bundled by Vite and run with `node --jitless --predictable`
// like `stream-flush.ts`. Exits non-zero when a render comes out wrong, so a fast but wrong shell cannot pass.

import { renderToString } from "react-dom/server";

import { App } from "../../src/app/App";
import { createBridge } from "../../src/app/bridge/bridge";
import { FakeCore } from "../../src/core/fake/fake-core";
import { pageFor } from "../../src/features/shell/pages";
import { modeIndicator } from "../../src/features/shell/mode-indicator";
import { SECTIONS } from "../../src/features/shell/sections";
import { Sidebar } from "../../src/features/shell/sidebar";

const ROUNDS = 40;

const expect = (ok: boolean, what: string) => {
  if (!ok) throw new Error(`ui_shell_render: ${what}`);
};

const bridge = createBridge("main", new FakeCore({ window: "main" }));
await bridge.open();
const s = bridge.store.getState();
expect(s.status === "READY", "window not READY");
const mode = modeIndicator({ mode: s.whole.privacy!.mode, degraded: [], sensitiveCall: false });

for (let round = 0; round < ROUNDS; round++) {
  const html = renderToString(<App bridge={bridge} />);
  expect(["MW-R1", "MW-R2", "MW-R3"].every((r) => html.includes(`data-region="${r}"`)), "a region is missing");
  for (const section of SECTIONS) {
    const side = renderToString(
      <Sidebar
        selected={section.key}
        waiting={s.whole.proposals!.waiting}
        problems={s.whole.proposals!.needs_attention}
        live={null}
        mode={mode}
        footer="Idle"
        overlay={false}
        onSelect={() => {}}
        onShowCall={() => {}}
        onToggle={() => {}}
        onOpenPrivacy={() => {}}
      />,
    );
    const page = renderToString(<>{pageFor(section.key).render({ section: section.key, key: "root" })}</>);
    expect(side.split('aria-current="page"').length === 2 && page.includes("np-empty"), `section ${section.key} did not render once as current`);
  }
}
await bridge.close();
