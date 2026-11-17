import { describe, expect, it, vi } from "vitest";
import { checkTag, tagCalls } from "./tags";

vi.mock("../history/undo", () => ({ holdUndo: vi.fn() }));
import { holdUndo } from "../history/undo";

describe("tags", () => {
  it("refuses a blank or too long tag and keeps a good one as typed", () => {
    expect(checkTag("  ")).toEqual({ error: "tags.empty" });
    expect(checkTag("x".repeat(33))).toEqual({ error: "tags.long" });
    expect(checkTag(" release ")).toEqual({ tag: "release" });
  });
  it("sends the selected ids, hands the batch to the strip and replaces rows", async () => {
    const setState = vi.fn();
    const data = { calls: [{ id: "c1" }, { id: "c2" }], change_id: "ch1", batch_id: "b1" };
    const bridge = { act: vi.fn((_k, _c, run) => run().then(() => ({ status: "ok", data }))), core: { callTagsSet: vi.fn().mockResolvedValue(0) }, store: { setState } };
    const r = await tagCalls(bridge as never, ["c1", "c2"], ["release"], []);
    expect(r.status).toBe("ok");
    expect(bridge.core.callTagsSet).toHaveBeenCalledWith({ call_ids: ["c1", "c2"], add: ["release"], remove: [] });
    expect(holdUndo).toHaveBeenCalledWith(expect.objectContaining({ target: { type: "batch", batch_id: "b1" } }));
    expect(setState).toHaveBeenCalledTimes(2);
  });
  it("does not touch the strip when the write fails", async () => {
    vi.mocked(holdUndo).mockClear();
    const bridge = { act: vi.fn().mockResolvedValue({ status: "error" }), core: {}, store: {} };
    expect((await tagCalls(bridge as never, ["c1"], [], ["x"])).status).toBe("error");
    expect(holdUndo).not.toHaveBeenCalled();
  });
});
