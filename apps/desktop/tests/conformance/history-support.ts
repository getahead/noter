// Shared by the M2 history conformance and story tests: what only the real core's harness can
// tell (its data folder, its save panel) beside the typed client. The Scenario keeps its
// StdioCore private, and a harness control is a request on the same wire (docs/TEST-PLAN.md).
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

import type { Scenario } from "../support/scenario";

type Wire = { invoke(window: string, cmd: string, args: unknown): Promise<unknown> };
const wire = (s: Scenario) => (s as unknown as { process: Wire }).process;

/** The next save panel answers cancelled, once. On the fake the next `command` (an export) fails `cancelled`. */
export async function cancelNextSavePanel(s: Scenario, command: "history_export" | "calls_export" = "history_export"): Promise<void> {
  if (s.target === "fake") return s.failNext("main", command, "cancelled");
  await wire(s).invoke("main", "harness.cancel_next_save_panel", {});
}

/** The real core's data folder; null on the fake. */
export async function dataDir(s: Scenario): Promise<string | null> {
  if (s.target === "fake") return null;
  return ((await wire(s).invoke("main", "harness.data_dir", {})) as { path: string }).path;
}

/** Rows of the real core's database, read-only; null on the fake. */
export async function rows<T>(s: Scenario, sql: string, ...params: string[]): Promise<T[] | null> {
  const dir = await dataDir(s);
  if (!dir) return null;
  const db = new DatabaseSync(join(dir, "noter.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}
