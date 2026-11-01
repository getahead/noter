// M2 handoff stories against the real core (Backend Teamlead TL-18, HoD D-26): each test names its
// story and asserts the core-visible steps — the prompt state and its versions, the
// `entity:changed` events, the launch and clipboard the harness's scripted native ops recorded
// (`harness.native_log`, TL-15), the prompt file and the item's change row. Those exist only in the
// real core, so the fake skips this file; m2-handoff.test.ts runs the same commands on both.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { EntityChanged, HandoffView, LaunchPlan } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { StdioCore } from "../support/stdio-transport";

type Launch = { path: string; target: string; cwd: string; prompt_file: string };
type NativeLog = { launches: Launch[]; clipboard: { plain: string; markdown: string | null }[] };

let s: Scenario;
let repo: string;

/** The scenario's harness: controls are requests on the same wire. */
const harness = () => (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process;
const nativeLog = async () => (await harness().invoke("main", "harness.native_log", {})) as NativeLog;
const launchWorld = (plan: LaunchPlan) => harness().invoke("main", "harness.launch_world", { plan });

/** Rows of the real core's database, read-only. */
async function rows<T>(sql: string, ...params: string[]): Promise<T[]> {
  const { path } = (await harness().invoke("main", "harness.data_dir", {})) as { path: string };
  const db = new DatabaseSync(join(path, "noter.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}
const reasons = async (item: string) => (await rows<{ reason: string }>("SELECT reason FROM changes WHERE entity_type = 'item' AND entity_id = ? ORDER BY rowid", item)).map((r) => r.reason);

/** A fresh real core and a folder for the VSTOR project, mapped unless `mapped` is false. */
async function open(mapped = true): Promise<void> {
  s = openScenario({ alsoRecord: exercised });
  repo = mkdtempSync(join(tmpdir(), "noter-vhp-frontend-"));
  if (mapped) await mapVstor();
}
const mapVstor = async () => ok(await s.core("main").repoUpsert({ key: "VSTOR", local_path: repo, default_tool: "claude_code" }));

const handoffOf = (e: EntityChanged, item: string): HandoffView | undefined => (e.type === "handoff" && e.handoff.item.id === item ? e.handoff : undefined);

async function generate(item: string, regenerate = false): Promise<HandoffView> {
  const changed = await s.events("entity:changed");
  const started = ok(await s.core("main").handoffGenerate({ item_id: item, regenerate }));
  expect(started.state).toEqual({ type: "generating" });
  return until(() => changed.all.map((e) => handoffOf(e, item)).find((v) => v?.state.type === "ready"), `the ${item} prompt through entity:changed`);
}

describe.skipIf(isFake)("handoff stories on the real core (2.19)", () => {
  afterEach(async () => {
    await s.dispose();
    rmSync(repo, { recursive: true, force: true });
  });

  it("cpt-noter-seq-call-page-hand-off-item: the prompt is written, edited and opened pre-filled in Claude Code in the mapped repository; the item is handed off", async () => {
    await open(false);
    // The drawer opens: nothing written yet; no mapping yet, so Add Mapping… is prefilled.
    const drawer = ok(await s.core("main").handoffGet({ item_id: "itm_virt" }));
    expect(drawer.state).toEqual({ type: "not_generated" });
    expect(drawer).toMatchObject({ repo: null, unmapped_key: "VSTOR" });
    expect(drawer.launch).toEqual({ path: "claude_cli_link", needs_automation: false, automation_denied: false });
    // Writing the handoff prompt… then the prompt.
    const written = await generate("itm_virt");
    expect(written.prompt_md).toContain("Ask before touching anything outside this scope.");
    expect(written.versions.map((v) => v.kind)).toEqual(["generated"]);
    // Without a mapping Open is refused (Copy stays available); a new mapping enables it.
    expect(refused(await s.core("main").handoffOpen({ item_id: "itm_virt" })).code).toBe("repo_not_mapped");
    await mapVstor();
    expect(ok(await s.core("main").handoffGet({ item_id: "itm_virt" })).repo).toMatchObject({ key: "VSTOR", local_path: repo, path_exists: true });
    // Switching the target changes the launch line only; switching back restores it.
    const codex = ok(await s.core("main").handoffSetTarget({ item_id: "itm_virt", target: "codex" }));
    expect([codex.target, codex.launch.path, codex.versions.length]).toEqual(["codex", "codex_app", 1]);
    ok(await s.core("main").handoffSetTarget({ item_id: "itm_virt", target: "claude_code" }));
    // The user types a change: Edited, and Your Edit in the version menu; the generated prompt stays for the diff.
    const typed = `${written.prompt_md}\nKeep the row height.\n`;
    const changed = ok(await s.core("main").handoffEdit({ item_id: "itm_virt", rev: written.rev!, prompt_md: typed }));
    expect([changed.edited, changed.generated_md]).toEqual([true, written.prompt_md]);
    // A forced regeneration keeps the edit as the prompt and offers the new one beside it.
    await generate("itm_virt", true);
    const edited = ok(await s.core("main").handoffGet({ item_id: "itm_virt" }));
    expect(edited.prompt_md).toBe(typed);
    expect(edited.versions.map((v) => v.kind)).toEqual(["generated", "user_edit", "generated"]);
    // Open in Claude Code: the prompt file first, then the link with only the folder and the file.
    const opened = ok(await s.core("main").handoffOpen({ item_id: "itm_virt" }));
    expect(opened.path_used).toBe("claude_cli_link");
    expect(readFileSync(opened.prompt_file, "utf8")).toBe(edited.prompt_md);
    const log = await nativeLog();
    expect(log.launches).toEqual([{ path: "claude_cli_link", target: "claude_code", cwd: repo, prompt_file: opened.prompt_file }]);
    expect(log.clipboard).toEqual([]);
    // Handed off to Claude Code, the item marked Handed off; the change names the version used.
    expect(opened.item).toMatchObject({ status: "handed_off", review: "accepted", handoff: { target: "claude_code", cwd: repo, awaiting: true } });
    expect((await reasons("itm_virt")).at(-1)).toBe(`handoff_open: ${changed.versions[1].id} edited`);
  });

  it("cpt-noter-seq-call-page-hand-off-item (error, no Claude Code link handler): the terminal fallback opens; Automation denied claims nothing and Copy Prompt still works", async () => {
    await open();
    await generate("itm_virt");
    await launchWorld({ path: "iterm", needs_automation: true, automation_denied: false });
    expect(ok(await s.core("main").handoffGet({ item_id: "itm_virt" })).launch).toEqual({ path: "iterm", needs_automation: true, automation_denied: false });
    expect(ok(await s.core("main").handoffOpen({ item_id: "itm_virt" })).path_used).toBe("iterm");
    const before = await reasons("itm_virt");
    await launchWorld({ path: "terminal", needs_automation: false, automation_denied: true });
    expect(refused(await s.core("main").handoffOpen({ item_id: "itm_virt" })).code).toBe("automation_denied");
    expect(await reasons("itm_virt")).toEqual(before);
    const copied = ok(await s.core("main").handoffCopy({ item_id: "itm_virt" }));
    expect(copied.item.status).toBe("handed_off");
    expect((await nativeLog()).clipboard).toHaveLength(1);
  });

  it("cpt-noter-seq-core-handoff: another owner's suggested item is copied as Markdown, accepted and handed off with its owner kept", async () => {
    await open();
    const drawer = ok(await s.core("main").handoffGet({ item_id: "itm_replay" }));
    expect(drawer.default_action).toBe("copy_prompt");
    const written = await generate("itm_replay");
    // A forced regeneration that is cancelled keeps the ready prompt and writes no version.
    ok(await s.core("main").handoffGenerate({ item_id: "itm_replay", regenerate: true }));
    const back = ok(await s.core("main").handoffCancel({ item_id: "itm_replay" }));
    expect(back.state).toEqual({ type: "ready" });
    expect(back.versions).toHaveLength(1);
    const copied = ok(await s.core("main").handoffCopy({ item_id: "itm_replay" }));
    expect(copied.chars).toBe([...written.prompt_md!].length);
    expect(copied.item).toMatchObject({ status: "handed_off", review: "accepted", owner: { id: "per_dmitri" } });
    expect((await nativeLog()).clipboard).toEqual([{ plain: written.prompt_md, markdown: written.prompt_md, html: null }]);
    expect((await reasons("itm_replay")).at(-1)).toBe(`handoff_copy: ${written.versions[0].id} unedited`);
    const versions = await rows<{ n: number; kind: string }>("SELECT n, kind FROM prompt_versions WHERE item_id = ? ORDER BY n", "itm_replay");
    expect(versions).toEqual([{ n: 1, kind: "generated" }]);
  });
});

describe.skipIf(isFake)("the handoff prompt on a scripted runtime (2.19, --llm-script)", () => {
  let core: StdioCore;
  let dir: string;
  afterEach(async () => {
    await core.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("cpt-noter-seq-call-page-hand-off-item (error, prompt not written): the failure is typed, Try Again writes the scripted prompt without the link it made up", async () => {
    dir = mkdtempSync(join(tmpdir(), "noter-llm-script-"));
    const output = { goal: "Virtualise the drawer table", context: "Said in the planning call.", constraints: ["Keep the row height"], acceptance: ["10k rows scroll at 60 fps"], links: ["VSTOR-1234", "https://made.up/x"], repo: null, guardrails: "Touch only the drawer list." };
    const script = [{ on: "handoff", fail: "rate_limited" }, { on: "handoff", output }];
    const file = join(dir, "llm.jsonl");
    writeFileSync(file, script.map((l) => JSON.stringify(l)).join("\n") + "\n");
    core = new StdioCore({ command: `${process.env.NOTER_CORE_CMD} --llm-script ${file}` });
    const view = async () => (await core.invoke("main", "handoff_get", { item_id: "itm_virt" })) as HandoffView;
    await core.invoke("main", "handoff_generate", { item_id: "itm_virt", regenerate: false });
    const failed = await until(async () => ((await view()).state.type === "failed" ? view() : undefined), "the failed prompt");
    expect(failed.versions).toEqual([]);
    await core.invoke("main", "handoff_generate", { item_id: "itm_virt", regenerate: true });
    const ready = await until(async () => {
      const v = await view();
      return v.state.type === "ready" ? v : undefined;
    }, "the scripted prompt");
    expect(ready.prompt_md).toContain("# Virtualise the drawer table");
    expect(ready.prompt_md).toContain("- VSTOR-1234");
    expect(ready.prompt_md).not.toContain("made.up");
  });
});
