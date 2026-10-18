// Playwright fixtures for the UI end-to-end flows (docs/TEST-PLAN.md).
//
// `scenario`: a fresh, isolated core for each test (tests/support/scenario.ts) — the fake core
// by default, the real core through noter-core-harness when NOTER_CORE=stdio. Its windows are
// typed clients built with `createCore`, exactly as the UI builds them.
//
// Command log: the story reporter (tests/support/story-reporter.ts) records the story IDs of
// the flows that passed; this worker fixture records the frozen commands those passing flows
// ran successfully, in the format scripts/harness/e2e_coverage.py reads:
//   coverage/e2e/commands-ui-e2e-flows-<target>-<worker>-<pid>.json
//   {"suite": "ui-e2e-flows", "target": "fake" | "stdio", "commands": [...], "stories": []}
// Runs against the fake core are written for insight and not counted.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base } from "@playwright/test";

import type { CommandName, CoreError } from "../../../src/core/bindings";
import { registerJsonModules } from "../../support/json-modules";
import type { Scenario, World } from "../../support/scenario";

// The fake core imports the fixture world as JSON; see json-modules.ts. The scenario module
// (and with it the fake) is therefore imported lazily, after the hook is in place.
registerJsonModules();
const target = process.env.NOTER_CORE === "stdio" ? "stdio" : "fake";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "coverage", "e2e");

export const test = base.extend<{ scenario: Scenario }, { commandLog: Set<CommandName> }>({
  commandLog: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const log = new Set<CommandName>();
      await use(log);
      mkdirSync(outDir, { recursive: true });
      const data = { suite: "ui-e2e-flows", target, commands: [...log].sort(), stories: [] };
      writeFileSync(join(outDir, `commands-ui-e2e-flows-${target}-${workerInfo.workerIndex}-${process.pid}.json`), JSON.stringify(data, null, 2) + "\n");
    },
    { scope: "worker", auto: true },
  ],
  scenario: async ({ commandLog }, use, testInfo) => {
    const { openScenario } = await import("../../support/scenario");
    const scenario = openScenario();
    await use(scenario);
    await scenario.dispose();
    // Only flows that passed count as exercising their commands.
    if (testInfo.status === "passed") scenario.exercised.forEach((c) => commandLog.add(c));
  },
});

export { expect } from "@playwright/test";

/** Put the world in a story's starting state (its preconditions). */
export async function given(scenario: Scenario, ...presets: Array<(w: World) => void>): Promise<void> {
  await scenario.change((w) => presets.forEach((p) => p(w)));
}

/**
 * `given` for a world slice that a later milestone's core owns (capture, detection, degraded,
 * calls, transcripts, copilot…): false while the real core answers `not_implemented` for that
 * slice, so the steps that need the state wait for that milestone. The fake always applies it.
 */
export async function changeAhead(scenario: Scenario, ...presets: Array<(w: World) => void>): Promise<boolean> {
  try {
    await given(scenario, ...presets);
    return true;
  } catch (e) {
    if ((e as CoreError | null)?.code === "not_implemented") return false;
    throw e;
  }
}

/** Versions of whole-state payloads only grow (ADR-0002, R25). */
export function versionsGrow(payloads: ReadonlyArray<{ version: number }>): boolean {
  return payloads.every((p, i) => i === 0 || p.version > payloads[i - 1].version);
}

/** Channel messages arrive with seq = previous + 1. */
export function seqContiguous(messages: ReadonlyArray<{ seq: number }>, from?: number): boolean {
  return messages.every((m, i) => m.seq === (i === 0 ? (from ?? m.seq - 1) + 1 : messages[i - 1].seq + 1));
}
