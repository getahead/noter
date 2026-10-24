import { describe, expect, it, vi } from "vitest";
import { deleteCalls } from "./delete-calls";

const calls = [
  { id: "c1", title: "A" },
  { id: "c2", title: "B" },
];
function bridge(result: unknown) {
  const callsDelete = vi.fn().mockResolvedValue(result);
  const act = vi.fn((_k: string, _c: string, run: () => Promise<unknown>) =>
    run(),
  );
  return { callsDelete, act, b: { act, core: { callsDelete } } as never };
}

describe("deleteCalls (cpt-noter-flow-ui-dialogs-host-delete-call)", () => {
  it("deletes nothing when the user cancels", async () => {
    const { b, callsDelete } = bridge({ status: "ok", data: null });
    expect(await deleteCalls(b, calls, async () => false)).toEqual({
      outcome: "cancelled",
    });
    expect(callsDelete).not.toHaveBeenCalled();
  });

  it("asks with the delete alert, then sends calls_delete with the ids through act", async () => {
    const { b, callsDelete, act } = bridge({ status: "ok", data: null });
    const ask = vi.fn().mockResolvedValue(true);
    expect(await deleteCalls(b, calls, ask)).toEqual({ outcome: "deleted" });
    expect(ask.mock.calls[0][0].title).toBe("Delete 2 calls?");
    expect(callsDelete).toHaveBeenCalledWith({ call_ids: ["c1", "c2"] });
    expect(act.mock.calls[0][1]).toBe("calls_delete");
  });

  it("returns the core's error, never retrying (already_recording included)", async () => {
    const error = { code: "already_recording" };
    const { b, callsDelete } = bridge({ status: "error", error });
    expect(await deleteCalls(b, calls.slice(0, 1), async () => true)).toEqual({
      outcome: "failed",
      error,
    });
    expect(callsDelete).toHaveBeenCalledTimes(1);
  });

  it("does nothing for an empty selection", async () => {
    const ask = vi.fn();
    expect(await deleteCalls(bridge(null).b, [], ask)).toEqual({
      outcome: "cancelled",
    });
    expect(ask).not.toHaveBeenCalled();
  });
});
