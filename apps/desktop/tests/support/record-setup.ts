// Vitest setup for suites that count toward E2E coverage. After each test file it
// writes to <repo>/coverage/e2e/ the commands this worker saw succeed and the
// story IDs (`cpt-noter-seq-…`) named by tests that passed. Only runs against the
// real core (target "stdio") count toward the gate; fake runs are kept for insight.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach } from "vitest";

import { disposeAll, exercised, target } from "./core";
import { storyIds } from "./stories";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const outDir = join(repoRoot, "coverage", "e2e");
const suite = process.env.NOTER_E2E_SUITE ?? "conformance";
const stories = new Set<string>();

afterEach(({ task }) => {
  if (task.result?.errors?.length) return;
  const names: string[] = [];
  for (let t: { name: string; suite?: unknown } | undefined = task; t; t = t.suite as typeof t) names.push(t.name);
  storyIds(names.join(" ")).forEach((id) => stories.add(id));
});

afterAll(async () => {
  await disposeAll();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `commands-${suite}-${target}-${process.pid}.json`);
  const data = { suite, target, commands: [...exercised].sort(), stories: [...stories].sort() };
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
});
