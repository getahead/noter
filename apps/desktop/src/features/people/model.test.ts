import { describe, expect, it, vi } from "vitest";
import { createPeopleList } from "./model";

const read = { people: [], unnamed: [] };
const bridge = (act: unknown) => ({ act, core: { peopleList: vi.fn() } }) as never;

describe("cpt-noter-state-ui-people-view", () => {
  it("LOADING until the read answers, then holds the answer", async () => {
    const list = createPeopleList(bridge(async () => ({ status: "ok", data: read })));
    expect(list.get().status).toBe("LOADING");
    await list.load();
    expect(list.get()).toMatchObject({ status: "READ", read });
  });
  it("a failed read is ERROR; Try Again reads once more", async () => {
    const act = vi.fn().mockResolvedValueOnce({ status: "error", error: { code: "internal" } }).mockResolvedValueOnce({ status: "ok", data: read });
    const list = createPeopleList(bridge(act));
    await list.load();
    expect(list.get().status).toBe("ERROR");
    await list.load();
    expect(list.get().status).toBe("READ");
  });
  it("a reload keeps the list on screen and shows the newer answer", async () => {
    const act = vi.fn().mockResolvedValueOnce({ status: "ok", data: read }).mockResolvedValueOnce({ status: "ok", data: { people: [1], unnamed: [] } });
    const list = createPeopleList(bridge(act));
    await list.load();
    const again = list.load();
    expect(list.get().status).toBe("READ");
    await again;
    expect(list.get()).toMatchObject({ read: { people: [1] } });
  });
  it("a read in flight is shared: StrictMode's second mount sends nothing more", async () => {
    const act = vi.fn(async () => ({ status: "ok", data: read }));
    const list = createPeopleList(bridge(act));
    await Promise.all([list.load(), list.load()]);
    expect(act).toHaveBeenCalledOnce();
  });
});
