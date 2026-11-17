import { describe, expect, it, vi } from "vitest";
import { moveFinished, moveStorage } from "./storage";

const bridge = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, f: () => unknown) => (void f(), res)), core: { storageMove: vi.fn() } }) as never;

describe("moveStorage", () => {
  it("accepts a job, never a path", async () => {
    expect(await moveStorage(bridge({ status: "ok", data: { job_run_id: "run_1" } }))).toEqual({ kind: "accepted", runId: "run_1" });
  });
  it("maps the cloud folder, a cancelled panel and any other failure", async () => {
    expect(await moveStorage(bridge({ status: "error", error: { code: "storage_in_cloud_folder" } }))).toEqual({ kind: "cloud" });
    expect(await moveStorage(bridge({ status: "error", error: { code: "cancelled" } }))).toEqual({ kind: "cancelled" });
    expect(await moveStorage(bridge({ status: "error", error: { code: "internal" } }))).toEqual({ kind: "failed" });
    // not_implemented (M4 on the real core) is its own outcome, so the pane can say it is not available yet
    expect(await moveStorage(bridge({ status: "error", error: { code: "not_implemented" } }))).toEqual({ kind: "later" });
  });
  it("a move is finished only by a terminal job status", () => {
    expect(["succeeded", "failed", "cancelled"].every((s) => moveFinished(s as never))).toBe(true);
    expect(moveFinished("running")).toBe(false);
    expect(moveFinished(undefined)).toBe(false);
  });
});
