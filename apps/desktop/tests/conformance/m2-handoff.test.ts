// 2.19 handoff against the fake and the real core: the ten handoff and repository commands, their
// window scopes, the prompt's revision, the async generation through `entity:changed` and the
// typed errors. The prompt versions, the launch log and the prompt file exist only in the real
// core (noter-handoff over the harness's scripted runtime and native ops), so the stories that
// look at them are in m2-stories-handoff.test.ts.
// @cpt-dod:cpt-noter-dod-core-handoff-tests:p1
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EntityChanged, HandoffView } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";

let s: Scenario;
let repo: string;
afterEach(async () => {
  await s.dispose();
  rmSync(repo, { recursive: true, force: true });
});

function open(): void {
  s = openScenario({ alsoRecord: exercised });
  repo = mkdtempSync(join(tmpdir(), "noter-repo-"));
}

const handoffOf = (e: EntityChanged, item: string): HandoffView | undefined => (e.type === "handoff" && e.handoff.item.id === item ? e.handoff : undefined);

/** Generates `item`'s prompt and waits for its ready view through `entity:changed`. */
async function ready(item: string): Promise<HandoffView> {
  const changed = await s.events("entity:changed");
  const started = ok(await s.core("main").handoffGenerate({ item_id: item, regenerate: true }));
  expect(started.state).toEqual({ type: "generating" });
  return until(() => changed.all.map((e) => handoffOf(e, item)).find((v) => v?.state.type === "ready"), `the ${item} prompt through entity:changed`);
}

describe("handoff and repository commands (2.19)", () => {
  it("handoff_generate answers generating at once and the ready prompt arrives through entity:changed", async () => {
    open();
    const view = await ready("itm_replay");
    expect(view.prompt_md).toContain("Ask before touching anything outside this scope.");
    expect(view.generated_md).toBe(view.prompt_md);
    expect(view.edited).toBe(false);
    const got = ok(await s.core("main").handoffGet({ item_id: "itm_replay" }));
    expect(got.state).toEqual({ type: "ready" });
    expect(got.prompt_md).toBe(view.prompt_md);
    // Another owner's item defaults to Copy Prompt.
    expect(got.default_action).toBe("copy_prompt");
    // Cached: without `regenerate` the ready prompt comes back as it is.
    expect(ok(await s.core("main").handoffGenerate({ item_id: "itm_replay", regenerate: false })).state).toEqual({ type: "ready" });
  });

  it("handoff_cancel stops a prompt being written and keeps the one before it", async () => {
    open();
    const before = await ready("itm_replay");
    ok(await s.core("main").handoffGenerate({ item_id: "itm_replay", regenerate: true }));
    const cancelled = ok(await s.core("main").handoffCancel({ item_id: "itm_replay" }));
    expect(cancelled.state).toEqual({ type: "ready" });
    expect(cancelled.prompt_md).toBe(before.prompt_md);
  });

  it("handoff_edit needs the prompt's current rev and keeps the generated prompt for the diff", async () => {
    open();
    const view = await ready("itm_replay");
    const rev = view.rev!;
    const stale = refused(await s.core("main").handoffEdit({ item_id: "itm_replay", rev: rev + 5, prompt_md: "# Mine" }));
    expect(stale.code).toBe("conflict");
    const empty = refused(await s.core("main").handoffEdit({ item_id: "itm_replay", rev, prompt_md: "  " }));
    expect(empty.code).toBe("invalid_input");
    const edited = ok(await s.core("main").handoffEdit({ item_id: "itm_replay", rev, prompt_md: "# Mine\n" }));
    expect(edited.edited).toBe(true);
    expect(edited.prompt_md).toBe("# Mine\n");
    expect(edited.generated_md).toBe(view.generated_md);
    expect(edited.rev).toBeGreaterThan(rev);
  });

  it("handoff_set_target switches the target without writing a prompt", async () => {
    open();
    const view = ok(await s.core("main").handoffSetTarget({ item_id: "itm_replay", target: "codex" }));
    expect(view.target).toBe("codex");
    expect(ok(await s.core("main").handoffGet({ item_id: "itm_replay" })).target).toBe("codex");
  });

  it("repos_list, repo_upsert and repo_remove keep the mappings, and a mapped project resolves on the item", async () => {
    open();
    const before = ok(await s.core("settings").reposList({})).mappings.length;
    const added = ok(await s.core("main").repoUpsert({ key: "CORE", local_path: repo, default_tool: "codex" }));
    const mapping = added.mappings.find((m) => m.key === "CORE")!;
    expect(mapping).toMatchObject({ local_path: repo, default_tool: "codex", path_exists: true });
    const dup = refused(await s.core("settings").repoUpsert({ key: "CORE", local_path: repo, default_tool: "codex" }));
    expect(dup).toMatchObject({ code: "invalid_input", detail: { type: "validation", field: "key", rule: "duplicate" } });
    const changed = ok(await s.core("settings").repoUpsert({ id: mapping.id, key: "CORE", local_path: repo, default_tool: "claude_code" }));
    expect(changed.mappings.find((m) => m.id === mapping.id)?.default_tool).toBe("claude_code");
    const removed = ok(await s.core("settings").repoRemove({ id: mapping.id }));
    expect(removed.mappings).toHaveLength(before);
    expect(refused(await s.core("settings").repoRemove({ id: mapping.id })).code).toBe("not_found");
    // Removing a mapping is a Settings action only.
    expect(refused(await s.core("main").repoRemove({ id: mapping.id })).code).toBe("window_not_allowed");
  });

  it("handoff_open hands the item off in its mapped repository and handoff_copy works for another owner", async () => {
    open();
    // The fixture world maps VSTOR already; the real core starts with no mappings.
    const mapped = ok(await s.core("main").reposList({})).mappings.some((m) => m.key === "VSTOR");
    if (!mapped) ok(await s.core("main").repoUpsert({ key: "VSTOR", local_path: repo, default_tool: "claude_code" }));
    await ready("itm_virt");
    const opened = ok(await s.core("main").handoffOpen({ item_id: "itm_virt" }));
    expect(opened.path_used).toBe("claude_cli_link");
    expect(opened.prompt_file).toMatch(/handoffs\/itm_virt\.md$/);
    expect(opened.item).toMatchObject({ id: "itm_virt", status: "handed_off", review: "accepted" });
    await ready("itm_replay");
    const copied = ok(await s.core("main").handoffCopy({ item_id: "itm_replay" }));
    expect(copied.chars).toBeGreaterThan(0);
    // The suggested item is accepted and handed off; its owner stays.
    expect(copied.item).toMatchObject({ id: "itm_replay", status: "handed_off", review: "accepted", owner: { id: "per_dmitri" } });
  });

  it("refuses an unknown item, a non-engineering item and the handoff commands from other windows", async () => {
    open();
    expect(refused(await s.core("main").handoffGet({ item_id: "itm_nope" })).code).toBe("not_found");
    const plain = refused(await s.core("main").handoffGet({ item_id: "itm_a11y" }));
    expect(plain).toMatchObject({ code: "invalid_input", detail: { type: "validation", field: "item_id" } });
    expect(refused(await s.core("settings").handoffGet({ item_id: "itm_virt" })).code).toBe("window_not_allowed");
    expect(refused(await s.core("call-screen").handoffCopy({ item_id: "itm_virt" })).code).toBe("window_not_allowed");
  });
});
