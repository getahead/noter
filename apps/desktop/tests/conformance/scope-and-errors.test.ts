// ADR-0002 › window scope and typed errors, for every command of the contract.
import { describe, expect, it } from "vitest";

import { COMMANDS, ERROR_CODES, type CommandName, type WindowLabel } from "../../src/core/bindings";
import { transportFor } from "../support/core";

const ALL_WINDOWS: WindowLabel[] = ["main", "call-screen", "record-prompt", "settings", "first-run"];
const names = Object.keys(COMMANDS) as CommandName[];

function codeOf(e: unknown): string | undefined {
  return (e as { code?: string } | null)?.code;
}

// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
describe("window scope (PM-08)", () => {
  it.each(names)("%s is refused from every window it does not list", async (name) => {
    const allowed = COMMANDS[name].windows as readonly WindowLabel[];
    for (const window of ALL_WINDOWS.filter((w) => !allowed.includes(w))) {
      const t = transportFor(window);
      const err = await t.invoke(name, {}, COMMANDS[name].channel ? () => {} : undefined).then(
        () => null,
        (e) => e,
      );
      expect(codeOf(err), `${name} from ${window}`).toBe("window_not_allowed");
    }
  });
});

describe("typed errors", () => {
  it.each(names)("%s answers or rejects with a known CoreError, never crashes", async (name) => {
    const window = COMMANDS[name].windows[0] as WindowLabel;
    const t = transportFor(window);
    try {
      await t.invoke(name, {}, COMMANDS[name].channel ? () => {} : undefined);
    } catch (e) {
      const err = e as { code?: string; message?: unknown; retryable?: unknown };
      expect(ERROR_CODES as readonly string[]).toContain(err.code);
      expect(typeof err.message).toBe("string");
      expect(typeof err.retryable).toBe("boolean");
    }
  });
});
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
