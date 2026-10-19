// Run conformance against a core (docs/features/core/core-contract.md): a command may answer
// `not_implemented` only while the milestone that delivers it is later than the current one
// (harness/harness.toml); such commands are listed as pending in the run summary, by milestone,
// with the count of commands the core answers. Any other `not_implemented` fails, naming it.
//
// Each command is called with valid example arguments (./example-args.ts), not `{}`: the real
// core checks the window scope, then parses the arguments, then calls the method, so with `{}`
// an unimplemented command would answer `invalid_input` and pass as answered. An `invalid_input`
// for arguments the fake accepts therefore fails too: against the fake it means the table is
// wrong, against the real core that the core differs from the fake on that command. The rest of
// "differs from the fake" (scope, typed errors, streams, revisions, versions) is checked by the
// other files of this suite against the same fixtures. Each command runs in its own scenario (a
// fresh core on the fixture world), so a destructive command cannot change what the next one sees.
// The table is complete by construction (its type requires every command, and the first test below
// fails on a missing or extra entry), so every command is judged; none is left "not judged".
// @cpt-flow:cpt-noter-flow-core-contract-conformance:p1
import { afterAll, describe, expect, it } from "vitest";

import { COMMANDS, type CommandName, type WindowLabel } from "../../src/core/bindings";
import { target } from "../support/core";
import { openScenario } from "../support/scenario";
import { EXAMPLE_ARGS } from "./example-args";
import { CURRENT, isLater, milestoneOf, ORDER, summary } from "./milestones";

const names = Object.keys(COMMANDS) as CommandName[];
const pending = new Map<string, CommandName[]>();

describe("commands the core does not answer yet", () => {
  it("every command is placed in a milestone the harness orders, and the current one is among them", () => {
    expect(ORDER).toContain(CURRENT);
    for (const name of names) expect(ORDER, `milestone of ${name}`).toContain(milestoneOf(name));
  });

  it("not_implemented is pending only for a command delivered after the current milestone", () => {
    expect([isLater("app_snapshot", "pre-M0"), isLater("app_snapshot", "M0"), isLater("capture_start", "M0"), isLater("capture_start", "M1")]).toEqual([true, false, true, false]);
    expect(isLater("no_such_command", "pre-M0")).toBe(false);
  });

  // @cpt-dod:cpt-noter-dod-core-contract-conformance:p1
  // @cpt-dod:cpt-noter-dod-core-harness-conformance:p1
  it("runs against the core NOTER_CORE selects: the fake, or the real core through noter-core-harness", () => {
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-fake
    if (target === "fake") {
      expect(process.env.NOTER_CORE ?? "fake").toBe("fake");
      return;
    }
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-fake
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-stdio
    expect(process.env.NOTER_CORE_CMD).toMatch(/noter-core-harness/);
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-stdio
  });

  it("has example arguments for exactly the commands of the contract", () => {
    expect(Object.keys(EXAMPLE_ARGS).sort()).toEqual([...names].sort());
  });

  it.each(names)("%s answers, or is not_implemented only before its milestone", async (name) => {
    const s = openScenario(); // not recorded: the probe asserts no behaviour, so it must not count toward the E2E command gate
    const client = s.core(COMMANDS[name].windows[0] as WindowLabel) as unknown as Record<string, (a: unknown, m?: unknown) => Promise<{ status: string; error?: { code: string } }>>;
    const method = name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const res = await client[method](EXAMPLE_ARGS[name], COMMANDS[name].channel ? () => {} : undefined).finally(() => s.dispose());
    const code = res.status === "error" ? res.error?.code : null;
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-if-differs
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-fail-run
    expect(code, target === "fake" ? `the fake refuses the example arguments of ${name}: fix example-args.ts` : `${name} refuses arguments the fake accepts`).not.toBe("invalid_input");
    if (code !== "not_implemented") return;
    expect(isLater(name), `${name} answers not_implemented, but ${milestoneOf(name)} is not after the current ${CURRENT}`).toBe(true);
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-fail-run
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-if-differs
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-if-later
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-record-pending
    const m = milestoneOf(name)!;
    pending.set(m, [...(pending.get(m) ?? []), name]);
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-record-pending
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-if-later
  });

  afterAll(() => {
    const unanswered = [...pending.values()].reduce((n, cmds) => n + cmds.length, 0);
    // @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-return-conformance
    summary(target, names.length - unanswered, names.length, pending);
    // @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-return-conformance
  });
});
