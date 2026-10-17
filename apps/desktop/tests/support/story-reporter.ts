// Playwright reporter: records the story IDs of UI flows that passed, for the E2E
// coverage gate. Counts only when the flows ran against the real core
// (NOTER_CORE=stdio); runs against the fake core are written but not counted.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { storyIds } from "./stories";

export default class StoryReporter implements Reporter {
  private stories = new Set<string>();

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== "passed" || test.parent.project()?.name !== "e2e") return;
    storyIds(test.titlePath().join(" ")).forEach((id) => this.stories.add(id));
  }

  onEnd(_result: FullResult): void {
    const target = process.env.NOTER_CORE === "stdio" ? "stdio" : "fake";
    const out = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "coverage", "e2e");
    mkdirSync(out, { recursive: true });
    const data = { suite: "ui-e2e", target, commands: [], stories: [...this.stories].sort() };
    writeFileSync(join(out, `commands-ui-e2e-${target}.json`), JSON.stringify(data, null, 2) + "\n");
  }
}
