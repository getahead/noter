// Which core the suites run against, and a recording wrapper for E2E coverage.
//
//   NOTER_CORE=fake (default)  in-memory fake core over contracts/fixtures/world.json
//   NOTER_CORE=stdio           the real core: NOTER_CORE_CMD starts noter-core-harness
//
// Every command that *succeeds* is recorded; rejected calls (scope checks, forced
// failures, not_implemented) do not count as exercising a command.

import { createCore, type CommandName, type Transport, type WindowLabel } from "../../src/core/bindings";
import { FakeCore } from "../../src/core/fake/fake-core";
import { StdioCore } from "./stdio-transport";

export const target: "fake" | "stdio" = process.env.NOTER_CORE === "stdio" ? "stdio" : "fake";
export const isFake = target === "fake";

/** Commands that succeeded in this worker. */
export const exercised = new Set<CommandName>();

let shared: StdioCore | null = null;
const fakes: FakeCore[] = [];

export function recording(inner: Transport): Transport {
  return {
    async invoke(cmd, args, onMessage) {
      const result = await inner.invoke(cmd, args, onMessage);
      exercised.add(cmd);
      return result;
    },
    listen: (event, handler) => inner.listen(event, handler),
  };
}

/** A raw transport for `window` against the selected core. */
export function transportFor(window: WindowLabel): Transport {
  if (target === "stdio") {
    const command = process.env.NOTER_CORE_CMD;
    if (!command) throw new Error("NOTER_CORE=stdio needs NOTER_CORE_CMD (path to noter-core-harness and its flags)");
    shared ??= new StdioCore({ command });
    return recording(shared.transport(window));
  }
  const fake = new FakeCore({ window });
  fakes.push(fake);
  return recording(fake);
}

/** The typed client for `window`, exactly as the UI uses it. */
export function coreFor(window: WindowLabel) {
  return createCore(transportFor(window));
}

/** The fake behind a window, for fake-only scenario controls (failNext, world edits). */
export function fakeFor(window: WindowLabel): FakeCore {
  const fake = new FakeCore({ window });
  fakes.push(fake);
  return fake;
}

export async function disposeAll(): Promise<void> {
  fakes.splice(0).forEach((f) => f.dispose());
  if (shared) {
    await shared.close();
    shared = null;
  }
}
