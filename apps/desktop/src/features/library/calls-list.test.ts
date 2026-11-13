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

  it("does not restore a deleted call in the total from an in-flight page response", async () => {
    let finishPage: (value: unknown) => void = () => {};
    const callsList = vi
      .fn()
      .mockResolvedValueOnce(page([row("a"), row("b")], "next", 4))
      .mockReturnValueOnce(new Promise((resolve) => (finishPage = resolve)))
      .mockResolvedValueOnce(page([row("c"), row("d")], null, 3));
    const list = createCallsList({
      act: (_k: string, _c: string, run: () => Promise<unknown>) => run(),
      core: { callsList },
    } as never);
    await list.load();
    const paging = list.more();
    list.drop(["a"]);
    finishPage(page([row("c"), row("d")], null, 4));
    await paging;
    expect(list.get().total).toBe(3);
    expect(list.get().rows.map((r) => r.id)).toEqual(["b", "c", "d"]);
  });

  it("reloads the first page when deleting the loaded page leaves more calls", async () => {
    const loaded = Array.from({ length: 2 }, (_, i) => row(`loaded-${i}`));
    const { list, callsList } = setup(
      page(loaded, "page-2", 4),
      page([row("remaining-1"), row("remaining-2")], null, 2),
    );
    await list.load();
    list.drop(loaded.map((r) => r.id));
    list.drop(loaded.map((r) => r.id)); // deletion result and entity event can report the same ids
    await list.load();
    expect(callsList).toHaveBeenCalledTimes(2);
    expect(list.get()).toMatchObject({ status: "LISTED", total: 2, next: null });
    expect(list.get().rows.map((r) => r.id)).toEqual(["remaining-1", "remaining-2"]);
  });

  it("starts a fresh read instead of reusing an in-flight sorted page after its rows are deleted", async () => {
    let finishSort: (value: unknown) => void = () => {};
    const callsList = vi
      .fn()
      .mockResolvedValueOnce(page([row("loaded")], null, 2))
      .mockReturnValueOnce(new Promise((resolve) => (finishSort = resolve)))
      .mockResolvedValueOnce(page([row("remaining")], null, 1));
    const list = createCallsList({
      act: (_k: string, _c: string, run: () => Promise<unknown>) => run(),
      core: { callsList },
    } as never);
    await list.load();
    const sorting = list.sort("oldest");
    list.drop(["loaded"]);
    const reload = list.load();
    finishSort(page([row("stale")], null, 2));
    await Promise.all([sorting, reload]);
    expect(list.get()).toMatchObject({ status: "LISTED", total: 1 });
    expect(list.get().rows.map((r) => r.id)).toEqual(["remaining"]);
    expect(callsList).toHaveBeenCalledTimes(3);
  });

  it("only inserts newer unlisted calls in newest order, counts them once, and de-duplicates later pages", async () => {
    const old = row("old");
    const { list } = setup(
      page([row("newest"), row("middle")], "page-2", 3),
      page([row("middle", 2), old, row("old", 2)], null, 4),
    );
    await list.load();
    list.merge({ old }, new Set());
    expect(list.get().rows.map((r) => r.id)).toEqual(["newest", "middle"]);
    list.merge({ fresh: { ...row("fresh"), started_at: 2 } as CallRow }, new Set());
    expect(list.get().rows.map((r) => r.id)).toEqual(["fresh", "newest", "middle"]);
    expect(list.get().total).toBe(4);
    list.merge({ fresh: { ...row("fresh", 2), started_at: 2 } as CallRow }, new Set());
    expect(list.get().total).toBe(4);
    await list.more();
    expect(list.get().rows.map((r) => r.id)).toEqual(["fresh", "newest", "middle", "old"]);
    expect(new Set(list.get().rows.map((r) => r.id)).size).toBe(list.get().rows.length);
  });

  it("does not insert an unlisted update for a non-newest sort", async () => {
    const { list } = setup(page([row("a")], "next", 2));
    await list.sort("title");
    list.merge({ other: row("other") }, new Set());
    expect(list.get().rows.map((r) => r.id)).toEqual(["a"]);
  it("drops a next page superseded by a sort change", async () => {
    let release: (value: unknown) => void = () => {};
    const callsList = vi.fn()
      .mockResolvedValueOnce(page([row("a")], "c1"))
      .mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
      .mockResolvedValueOnce(page([row("z")], null));
    const list = createCallsList({ act: (_k: string, _c: string, run: () => Promise<unknown>) => run(), core: { callsList } } as never);
    await list.load();
    const pending = list.more();
    await list.sort("oldest");
    release(page([row("stale")]));
    await pending;
    expect(list.get().rows.map((r) => r.id)).toEqual(["z"]);
  });

  it("keeps the loaded page when the next page fails", async () => {
    const { list } = setup(page([row("a")], "c1"), { status: "error", error: { code: "internal" } });
    await list.load();
    await list.more();
    expect(list.get()).toMatchObject({ rows: [row("a")], next: "c1", status: "LISTED" });
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
    const { list } = setup(page([], null, 0));
    await list.load();
    list.merge({ n: row("n") }, new Set());
    expect(list.get()).toMatchObject({ status: "LISTED" });
    expect(list.get().rows.map((r) => r.id)).toEqual(["n"]);
    expect(list.get().total).toBe(1);
  });

  it("keeps a newer held row when an older entity snapshot arrives", async () => {
    const { list } = setup(page([row("a", 3)]));
    await list.load();
    list.merge({ a: row("a", 2) }, new Set());
    expect(list.get().rows[0]!.rev).toBe(3);
  });

  it("does not add fresh entity rows while loading or after a failed read", async () => {
    const { list } = setup({ status: "error", error: { code: "internal" } });
    list.merge({ fresh: row("fresh") }, new Set());
    expect(list.get().rows).toEqual([]);
    await list.load();
    list.merge({ fresh: row("fresh") }, new Set());
    expect(list.get()).toMatchObject({ status: "ERROR", rows: [] });
  });
});
