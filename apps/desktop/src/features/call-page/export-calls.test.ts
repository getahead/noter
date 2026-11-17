import { describe, expect, it, vi } from "vitest";
import { exportCall } from "./share-actions";

describe("exportCall for a Library selection", () => {
  it("sends only the selected ids and no scope", async () => {
    const callsExport = vi.fn().mockResolvedValue(0);
    const bridge = { act: vi.fn((_k, _c, run) => run()), core: { callsExport } };
    await exportCall(bridge as never, ["c1", "c2"], { summary_and_items: true, transcript: false, audio: false }, null);
    expect(callsExport).toHaveBeenCalledWith({ call_ids: ["c1", "c2"], include: { summary_and_items: true, transcript: false, audio: false }, scope: null });
    await exportCall(bridge as never, "c3", { summary_and_items: true, transcript: false, audio: false }, null);
    expect(callsExport).toHaveBeenLastCalledWith(expect.objectContaining({ call_ids: ["c3"] }));
  });
});
