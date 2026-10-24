import { describe, expect, it, vi } from "vitest";
import { createSheets } from "./sheets";

describe("createSheets (cpt-noter-state-ui-dialogs-host-sheet)", () => {
  it("opens a registered sheet with its props and closes it", () => {
    const s = createSheets();
    s.register("x", () => null);
    const seen = vi.fn();
    s.subscribe(seen);
    s.open("x", { a: 1 });
    expect(s.current()).toEqual({ id: "x", props: { a: 1 } });
    s.close();
    expect(s.current()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("ignores a sheet nobody registered and a close with nothing open", () => {
    const s = createSheets();
    const seen = vi.fn();
    s.subscribe(seen);
    s.open("nope");
    s.close();
    expect(s.current()).toBeNull();
    expect(seen).not.toHaveBeenCalled();
  });

  it("replaces the open sheet and stops telling an unsubscribed listener", () => {
    const s = createSheets();
    s.register("a", () => null);
    s.register("b", () => null);
    const seen = vi.fn();
    const off = s.subscribe(seen);
    s.open("a");
    s.open("b");
    expect(s.current()?.id).toBe("b");
    off();
    s.close();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
