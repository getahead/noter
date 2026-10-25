import { describe, expect, it, vi } from "vitest";
import type { CallRow } from "../../core/bindings";
import { createCallsList } from "./calls-list";

const row = (id: string, rev = 1) =>
  ({ id, rev, started_at: 1, duration_ms: 1 }) as CallRow;
const page = (
  rows: CallRow[],
  next: string | null = null,
  total: number | null = null,
) => ({ status: "ok" as const, data: { rows, next_cursor: next, total } });

function setup(...answers: unknown[]) {
  const callsList = vi.fn();
  answers.forEach((a) => callsList.mockResolvedValueOnce(a));
  const act = vi.fn((_k: string, _c: string, run: () => Promise<unknown>) =>
    run(),
  );
  return {
    callsList,
    list: createCallsList({ act, core: { callsList } } as never),
  };
}

describe("createCallsList (cpt-noter-state-ui-library-calls-list)", () => {
  it("starts LOADING, reads the first page newest first with no filter, then is LISTED", async () => {
    const { list, callsList } = setup(page([row("a"), row("b")], null, 2));
    expect(list.get().status).toBe("LOADING");
    await list.load();
    expect(callsList).toHaveBeenCalledWith({
      filter: {},
      sort: "newest",
      page: {},
    });
    expect(list.get()).toMatchObject({ status: "LISTED", total: 2 });
    expect(list.get().rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("is EMPTY for a first page without calls and ERROR when the read fails, Try Again loads again", async () => {
    const { list } = setup(
      page([]),
      { status: "error", error: { code: "internal" } },
      page([row("a")]),
    );
    await list.load();
    expect(list.get().status).toBe("EMPTY");
    await list.load();
    expect(list.get().status).toBe("ERROR");
    await list.load();
    expect(list.get().status).toBe("LISTED");
  });

  it("reads the next page with the cursor once, and nothing at the end", async () => {
    const { list, callsList } = setup(
      page([row("a")], "c1"),
      page([row("b")], null),
    );
    await list.load();
    await Promise.all([list.more(), list.more()]); // one read per page
    await list.more();
    expect(callsList).toHaveBeenCalledTimes(2);
    expect(callsList.mock.calls[1][0].page).toEqual({ cursor: "c1" });
    expect(list.get().rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("a new sort replaces the rows and an older answer cannot overwrite it", async () => {
    let slow: (v: unknown) => void = () => {};
    const callsList = vi
      .fn()
      .mockReturnValueOnce(new Promise((r) => (slow = r)))
      .mockResolvedValueOnce(page([row("z")]));
    const list = createCallsList({
      act: (_k: string, _c: string, run: () => Promise<unknown>) => run(),
      core: { callsList },
    } as never);
    const first = list.load();
    await list.sort("oldest");
    slow(page([row("old")]));
    await first;
    expect(list.get()).toMatchObject({ sort: "oldest" });
    expect(list.get().rows.map((r) => r.id)).toEqual(["z"]);
  });

  it("drops deleted calls, goes EMPTY with the last one, and a changed record replaces its row", async () => {
    const { list } = setup(page([row("a"), row("b")]));
    await list.load();
    list.merge({ a: row("a", 2) }, new Set());
    expect(list.get().rows[0]!.rev).toBe(2);
    list.drop(["a"]);
    expect(list.get().rows.map((r) => r.id)).toEqual(["b"]);
    list.drop(["b"]);
    expect(list.get().status).toBe("EMPTY");
  });

  it("a recorded call arriving by entity:changed lists it first when EMPTY", async () => {
    const { list } = setup(page([]));
    await list.load();
    list.merge({ n: row("n") }, new Set());
    expect(list.get()).toMatchObject({ status: "LISTED" });
    expect(list.get().rows.map((r) => r.id)).toEqual(["n"]);
  });
});
