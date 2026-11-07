import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import { readPeople } from "./people";

const bridge = (status: "ok" | "error") => {
  const act = vi.fn(async () => (status === "ok" ? { status, data: { people: [{ id: "p1" }] } } : { status, error: { code: "not_implemented" } }));
  return { b: { act, core: { peopleList: vi.fn() } } as unknown as Bridge, act };
};

describe("people read", () => {
  it("reads once per bridge and gives the rows", async () => {
    const { b, act } = bridge("ok");
    expect(await readPeople(b)).toEqual([{ id: "p1" }]);
    await readPeople(b);
    expect(act).toHaveBeenCalledTimes(1);
  });
  it("is null when the core has no directory yet", async () => {
    expect(await readPeople(bridge("error").b)).toBeNull();
  });
});
