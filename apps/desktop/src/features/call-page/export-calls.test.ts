import { describe, expect, it, vi } from "vitest";
import { exportCall, runExport } from "./share-actions";

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

describe("runExport outcomes (named states, not one generic failure)", () => {
  const run = (error: string | null) => {
    const bridge = { act: vi.fn().mockResolvedValue(error ? { status: "error", error: { code: error } } : { status: "ok", data: { path: "/x", files: 1 } }), core: {} };
    return runExport(bridge as never, ["a", "b"], { summary_and_items: true, transcript: false, audio: false }, null);
  };
  it("done, cancelled, nothing-to-export-yet (never retryable) and a plain failure", async () => {
    expect(await run(null)).toEqual({ kind: "done", path: "/x" });
    expect(await run("cancelled")).toEqual({ kind: "cancelled" });
    expect(await run("outputs_not_ready")).toEqual({ kind: "not_ready" });
    expect(await run("internal")).toEqual({ kind: "failed" });
  });
});
