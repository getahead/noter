// The Delete Old Audio sheet's submit: the 30-day command runs once, the totals come from its result, and a failure
// keeps the sheet open with the error.
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import { rendered } from "../testing";
import { OldAudioSheet } from "./old-audio";

const bridgeAnswering = (answer: unknown) => {
  const audioDeleteOlder = vi.fn(async () => answer);
  const bridge = { act: async (_key: string, _cmd: string, run: () => unknown) => run(), core: { audioDeleteOlder } } as unknown as Bridge;
  return { bridge, audioDeleteOlder };
};
const press = async (bridge: Bridge, close: () => void, onFreed: (text: string) => void) => {
  const tree = rendered(OldAudioSheet, { close, bridge, onFreed } as never);
  await (tree.props.onDelete as () => Promise<void> | void)();
  await new Promise((r) => setTimeout(r));
};

describe("OldAudioSheet (inst-sheet-submit, inst-delete-old, inst-sheet-return)", () => {
  it("asks the core to delete audio older than 30 days, reports the freed totals and closes", async () => {
    const { bridge, audioDeleteOlder } = bridgeAnswering({ status: "ok", data: { calls: 3, freed_mb: 412.4 } });
    const close = vi.fn();
    const freed = vi.fn();
    await press(bridge, close, freed);
    expect(audioDeleteOlder).toHaveBeenCalledWith({ older_than_days: 30 });
    expect(freed).toHaveBeenCalledWith("Freed 412 MB across 3 calls");
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the sheet open and reports nothing when the core refuses", async () => {
    const { bridge, audioDeleteOlder } = bridgeAnswering({ status: "error", error: { code: "internal", message: "" } });
    const close = vi.fn();
    const freed = vi.fn();
    await press(bridge, close, freed);
    expect(audioDeleteOlder).toHaveBeenCalledOnce();
    expect(freed).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
