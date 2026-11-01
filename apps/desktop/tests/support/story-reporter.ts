// Playwright reporter: records the story IDs of UI flows that passed, for the E2E
// coverage gate. Counts only when the flows ran against the real core
// (NOTER_CORE=stdio); runs against the fake core are written but not counted.
// Stories are also kept per spec (`by_spec`), so that a pull request that re-runs only some specs
// is judged with main's logs for the others (scripts/harness/e2e_coverage.py --baseline).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { storyIds } from "./stories";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export default class StoryReporter implements Reporter {
  private stories = new Map<string, Set<string>>(); // spec (relative to apps/desktop) -> story IDs

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed" || test.parent.project()?.name !== "e2e") return;
    const spec = relative(appRoot, test.location.file).split("\\").join("/");
    const ids = this.stories.get(spec) ?? new Set<string>();
    storyIds(test.titlePath().join(" ")).forEach((id) => ids.add(id));
    this.stories.set(spec, ids);
  }

  onEnd(_result: FullResult): void {
    const target = process.env.NOTER_CORE === "stdio" ? "stdio" : "fake";
    const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "coverage", "e2e");
    mkdirSync(out, { recursive: true });
    const all = new Set([...this.stories.values()].flatMap((ids) => [...ids]));
    const bySpec = Object.fromEntries([...this.stories].sort().map(([spec, ids]) => [spec, { commands: [], stories: [...ids].sort() }]));
    const data = { suite: "ui-e2e", target, commands: [], stories: [...all].sort(), by_spec: bySpec };
    writeFileSync(join(out, `commands-ui-e2e-${target}.json`), JSON.stringify(data, null, 2) + "\n");
  }
}
