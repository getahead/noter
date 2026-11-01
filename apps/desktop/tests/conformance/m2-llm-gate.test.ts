// 2.15 llm-gate against the real core (AC 7, TL-13): `accounts_get` and `api_key_set` over the
// harness's scripted runtime and Keychain stand-in, and a skill answer through the egress gate with
// its `audit_log` row. Against the fake the contract is the same: the shapes, the typed errors and
// no key in any result or event. The scripted runtime, its `--llm-script` and the audit row exist
// only in the real core, so those tests run on NOTER_CORE=stdio.
// @cpt-dod:cpt-noter-dod-core-llm-gate-tests:p1
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { AccountsView, KeyProvider } from "../../src/core/bindings";
import { exercised, target } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { StdioCore } from "../support/stdio-transport";

const KEY = "sk-conformance-0123456789abcdef";

const status = (view: AccountsView, provider: KeyProvider) => view.keys.find((k) => k.provider === provider)?.status;

describe("accounts_get and api_key_set (2.15, credentials flow -keys)", () => {
  let s: Scenario;
  afterEach(async () => {
    await s.dispose();
  });

  it("accounts_get answers each key, both own-account tools and the local runtime, from every window that may ask", async () => {
    s = openScenario({ alsoRecord: exercised });
    const view = ok(await s.core("settings").accountsGet({}));
    expect(view.keys.map((k) => k.provider).sort()).toEqual(["anthropic", "codex"]);
    expect(view.accounts.map((a) => a.cli.tool).sort()).toEqual(["claude_code", "codex"]);
    expect(view.local.cli.tool).toBe("ollama");
    expect(view.version).toBeGreaterThanOrEqual(1);
    for (const window of ["main", "first-run"] as const) {
      expect(ok(await s.core(window).accountsGet({})).keys).toHaveLength(2);
    }
  });

  it("a verified key reads configured everywhere, and no result or event carries it", async () => {
    s = openScenario({ alsoRecord: exercised });
    const changed = await s.events("accounts:changed");
    const before = ok(await s.core("settings").accountsGet({}));
    expect(status(before, "codex")).toEqual({ type: "not_set" });
    const set = ok(await s.core("first-run").apiKeySet({ provider: "codex", key: KEY }));
    expect(status(set, "codex")).toMatchObject({ type: "configured" });
    expect(set.version).toBeGreaterThan(before.version);
    const after = ok(await s.core("main").accountsGet({}));
    expect(status(after, "codex")).toEqual(status(set, "codex"));
    const last = await until(() => changed.all.find((v) => status(v, "codex")?.type === "configured"), "accounts:changed with the configured key");
    expect(last.version).toBeLessThanOrEqual(after.version);
    expect(JSON.stringify([set, after, changed.all])).not.toContain(KEY);
  });

  it("refuses a key from the main window and an empty key, with typed errors", async () => {
    s = openScenario({ alsoRecord: exercised });
    expect(refused(await s.core("main").apiKeySet({ provider: "codex", key: KEY })).code).toBe("window_not_allowed");
    const empty = refused(await s.core("settings").apiKeySet({ provider: "codex", key: "   " }));
    expect(empty.code).toBe("invalid_input");
    expect(status(ok(await s.core("settings").accountsGet({})), "codex")).toEqual({ type: "not_set" });
  });
});

/** A harness of its own, its scripted runtime playing `lines` (TL-13 `--llm-script`). */
function scripted(lines: object[]): { core: StdioCore; done: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), "noter-llm-script-"));
  const file = join(dir, "llm.jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const core = new StdioCore({ command: `${process.env.NOTER_CORE_CMD} --llm-script ${file}` });
  return { core, done: async () => (await core.close(), rmSync(dir, { recursive: true, force: true })) };
}

type LlmRun = { output: { summary_md: string }; runtime: string; llm_run_id: string; audit: { llm_run_id: string; kind: string; destination: string; what: string }[] };

describe.runIf(target === "stdio")("the real core's scripted runtime and Keychain stand-in (2.15 AC 7)", () => {
  let run: ReturnType<typeof scripted>;
  afterEach(async () => {
    await run.done();
  });

  it("a scripted rejection makes api_key_set answer key_rejected and keeps no key", async () => {
    run = scripted([{ on: "ask-answer", fail: "key_rejected" }]);
    await expect(run.core.invoke("settings", "api_key_set", { provider: "anthropic", key: KEY })).rejects.toMatchObject({ code: "key_rejected" });
    const view = (await run.core.invoke("settings", "accounts_get", {})) as AccountsView;
    expect(status(view, "anthropic")).toEqual({ type: "rejected", reason: "key_rejected" });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it("a scripted skill answer crosses the egress gate with its audit_log row, on the stored key's runtime", async () => {
    const summary = { lang: "en", summary_md: "From the script.", decisions: [], action_items: [], open_questions: [], risks: [], per_participant: [], extras_md: null };
    run = scripted([{ on: "post-call", output: summary }]);
    await run.core.invoke("settings", "api_key_set", { provider: "anthropic", key: KEY });
    const ran = (await run.core.invoke("main", "harness.llm_run" as never, { skill: "post-call", items: [{ id: "seg_1", text: "Ann agreed to ship on Friday." }] })) as LlmRun;
    expect(ran.output.summary_md).toBe("From the script.");
    expect(ran.runtime).toBe("claude_api_key");
    expect(ran.audit).toEqual([expect.objectContaining({ llm_run_id: ran.llm_run_id, kind: "run", destination: "api.anthropic.com" })]);
  });

  it("a locked Keychain answers keychain_locked and reads locked until it opens", async () => {
    run = scripted([]);
    await run.core.invoke("main", "harness.keychain" as never, { locked: true });
    await expect(run.core.invoke("settings", "api_key_set", { provider: "codex", key: KEY })).rejects.toMatchObject({ code: "keychain_locked", retryable: true });
    expect(status((await run.core.invoke("settings", "accounts_get", {})) as AccountsView, "codex")).toEqual({ type: "keychain_locked" });
    await run.core.invoke("main", "harness.keychain" as never, { locked: false });
    expect(status((await run.core.invoke("settings", "accounts_get", {})) as AccountsView, "codex")).toEqual({ type: "not_set" });
  });
});
