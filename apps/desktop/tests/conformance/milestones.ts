// Which milestone delivers each command (harness/milestones.toml) and which one is current
// (harness/harness.toml [milestone]), so the suite judges a core that answers `not_implemented`
// by milestone: pending when the command's milestone is later than the current one, a failure
// otherwise (docs/features/core/core-contract.md › Run conformance against a core).
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CommandName } from "../../src/core/bindings";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** `[section]` → its body. shortcut: reads only the string and string-array keys the harness files use; switch to a TOML parser if they grow tables of tables. */
function sections(path: string): Map<string, string> {
  const out = new Map<string, string>();
  let name = "";
  for (const line of readFileSync(join(repoRoot, path), "utf8").split("\n")) {
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header) name = header[1];
    else out.set(name, (out.get(name) ?? "") + line.replace(/#.*$/, "") + "\n");
  }
  return out;
}

function strings(body: string | undefined, key: string): string[] {
  const m = new RegExp(`^${key}\\s*=\\s*(\\[[^\\]]*\\]|"[^"]*")`, "m").exec(body ?? "");
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : [];
}

const harness = sections("harness/harness.toml").get("milestone");
/** Milestones in delivery order, `pre-M0` first. */
export const ORDER = strings(harness, "order");
export const CURRENT = strings(harness, "current")[0];

const placed = new Map<string, string>();
for (const [milestone, body] of sections("harness/milestones.toml")) {
  for (const cmd of strings(body, "commands")) placed.set(cmd, milestone);
}

/** The milestone that delivers `cmd`, or undefined if harness/milestones.toml does not place it. */
export function milestoneOf(cmd: string): string | undefined {
  return placed.get(cmd);
}

/** True when `cmd` is delivered by a milestone later than `current` (the harness's, by default). */
export function isLater(cmd: string, current = CURRENT): boolean {
  const m = milestoneOf(cmd);
  return m !== undefined && ORDER.indexOf(m) > ORDER.indexOf(current);
}

/** Prints the run summary and adds it to the CI step summary when there is one. */
export function summary(target: string, answered: number, total: number, pending: Map<string, CommandName[]>): string {
  const lines = [`### Conformance (${target}): ${answered} of ${total} commands answered; current milestone ${CURRENT}`];
  for (const m of ORDER) {
    const cmds = pending.get(m);
    if (cmds?.length) lines.push(`- ${m}, not answered yet (${cmds.length}): ${cmds.sort().join(", ")}`);
  }
  const text = lines.join("\n") + "\n";
  process.stderr.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  return text;
}
