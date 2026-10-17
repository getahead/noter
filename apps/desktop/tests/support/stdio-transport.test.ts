// Unit test of the stdio transport against a scripted core (tests/support/fixtures/echo-core.mjs).
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { splitCommand, StdioCore } from "./stdio-transport";

const script = fileURLToPath(new URL("./fixtures/echo-core.mjs", import.meta.url));
let core: StdioCore | null = null;

afterEach(async () => {
  await core?.close();
  core = null;
});

describe("StdioCore", () => {
  it("resolves results, rejects CoreErrors and passes the window", async () => {
    core = new StdioCore({ command: `node "${script}"` });
    const main = core.transport("main");
    await expect(main.invoke("app_snapshot", {})).resolves.toEqual({ window: "main", cmd: "app_snapshot" });
    await expect(main.invoke("calls_delete", {})).rejects.toMatchObject({ code: "window_not_allowed" });
  });

  it("delivers channel messages and events", async () => {
    core = new StdioCore({ command: `node "${script}"` });
    const call = core.transport("call-screen");
    const events: unknown[] = [];
    const off = await call.listen("capture:state", (p) => events.push(p));
    const got: unknown[] = [];
    await call.invoke("transcript_subscribe", { call_id: "c" }, (m) => got.push(m));
    await expect.poll(() => got.length).toBe(2);
    await expect.poll(() => events.length).toBe(1);
    expect(got).toEqual([{ seq: 1 }, { seq: 2 }]);
    off();
  });

  it("rejects pending and later calls when the process dies", async () => {
    core = new StdioCore({ command: `node "${script}"` });
    const main = core.transport("main");
    await expect(main.invoke("app_exit" as never, {})).rejects.toThrow(/exited/);
    await expect(main.invoke("app_snapshot", {})).rejects.toThrow(/exited/);
  });

  it("splits command lines with quotes", () => {
    expect(splitCommand(`a "b c" d`)).toEqual(["a", "b c", "d"]);
    expect(() => splitCommand("  ")).toThrow();
  });
});
