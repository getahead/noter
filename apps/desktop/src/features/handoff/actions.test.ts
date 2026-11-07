// The handoff commands against the real bridge and the fake core: what each sends, what the drawer then shows and keeps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { CommandName, ErrorCode, HandoffView } from "../../core/bindings";
import type { FakeCore } from "../../core/fake/fake-core";

const ID = "itm_replay";
let bridge: Bridge;
let fake: FakeCore;
// the fake keeps its handoff revisions at module level: every test gets a fresh module graph
let A!: typeof import("./actions");
let L!: typeof import("./local");
afterEach(() => {
  vi.useRealTimers();
  return bridge.close();
});

async function ready(own = true) {
  vi.resetModules();
  A = await import("./actions");
  L = await import("./local");
  const { FakeCore } = await import("../../core/fake/fake-core");
  const { createBridge } = await import("../../app/bridge/bridge");
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  const it = fake.world.items.find((i) => i.id === ID)!;
  if (own) Object.assign(it, { owner: { ...fake.world.people.find((p) => p.is_you)!, is_you: true } });
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (cmd !== "log_ui" && seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const map = () => fake.world.repos.mappings.splice(0, fake.world.repos.mappings.length, { id: "rep_1", key: "VSTOR", local_path: "/work/vhi", default_tool: "claude_code", path_exists: true });
const refuse = (cmd: CommandName, code: ErrorCode) => fake.failNext(cmd, code);

describe("load and generate (cpt-noter-flow-ui-handoff-prepare)", () => {
  it("handoff_get puts the view in the store and writes nothing when a prompt exists", async () => {
    await ready();
    const seen = sent();
    await A.load(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_get"]);
    expect(A.viewOf(bridge, ID)?.prompt_md).toContain("Replay buffer");
  });

  it("a view without a prompt asks the core to write it; the finished prompt arrives as an event", async () => {
    await ready();
    const real = (await fake.invoke("handoff_get", { item_id: ID })) as HandoffView;
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((c: string, a: unknown) => (c === "handoff_get" ? Promise.resolve({ ...real, state: { type: "not_generated" }, rev: null, prompt_md: null, generated_md: null }) : (invoke as (...x: unknown[]) => unknown)(c, a))) as typeof fake.invoke;
    const seen = sent();
    await A.load(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_get", "handoff_generate"]);
    expect(seen[1]![1]).toEqual({ item_id: ID, regenerate: false });
  });

  it("a refused get is a load failure the drawer can retry", async () => {
    await ready();
    refuse("handoff_get", "internal");
    await A.load(bridge, ID);
    expect(L.localOf(ID).loadFailed).toBe("internal");
  });

  it("a refused write is a generation failure; Regenerate drops the edit and the outcome", async () => {
    await ready();
    refuse("handoff_generate", "runtime_unavailable");
    L.patchLocal(ID, { draft: "mine", showDiff: true, opened: "iterm" });
    await A.generate(bridge, ID, true);
    expect(L.localOf(ID)).toMatchObject({ genFailed: "runtime_unavailable" });
    expect(L.localOf(ID).draft).toBeUndefined();
    expect(L.localOf(ID).opened).toBeUndefined();
    await A.generate(bridge, ID, false); // Try Again: the next write is not refused
    expect(L.localOf(ID).genFailed).toBeUndefined();
  });

  it("Cancel keeps the core's previous state over a completion that was already on its way", async () => {
    await ready();
    await A.load(bridge, ID);
    await A.generate(bridge, ID, true);
    await A.cancel(bridge, ID);
    const kept = A.viewOf(bridge, ID)!;
    expect(kept.state.type).toBe("not_generated"); // nothing was written before: the core's previous state
    // the late completion lands in the store, but the drawer keeps showing what Cancel returned
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, handoff: { ...s.entities.handoff, [ID]: { ...kept, state: { type: "ready" }, rev: 9, prompt_md: "late" } } } }));
    expect(A.viewOf(bridge, ID)?.state.type).toBe("not_generated");
    await A.generate(bridge, ID, true);
    expect(L.localOf(ID).restored).toBeUndefined();
  });
});

describe("edit, target, copy and open (cpt-noter-flow-ui-handoff-deliver)", () => {
  it("keeps text typed during a save and does not launch the older saved prompt", async () => {
    await ready();
    map();
    await A.load(bridge, ID);
    L.patchLocal(ID, { draft: "First draft" });
    const edit = bridge.core.handoffEdit.bind(bridge.core);
    vi.spyOn(bridge.core, "handoffEdit").mockImplementation(async (args) => {
      const result = await edit(args);
      L.patchLocal(ID, { draft: "Newer draft" });
      return result;
    });
    const seen = sent();
    await A.open(bridge, ID);
    expect(L.localOf(ID).draft).toBe("Newer draft");
    expect(seen.map((s) => s[0])).toEqual(["handoff_edit"]);
  });

  it("saves the draft with the rev it was based on before the action, and only then acts", async () => {
    await ready();
    map();
    await A.load(bridge, ID);
    const rev = A.viewOf(bridge, ID)!.rev;
    L.patchLocal(ID, { draft: "Fix the overflow." });
    const seen = sent();
    await A.open(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_edit", "handoff_open"]);
    expect(seen[0]![1]).toEqual({ item_id: ID, rev, prompt_md: "Fix the overflow." });
    expect(L.localOf(ID)).toMatchObject({ opened: "claude_cli_link" });
    expect(L.localOf(ID).draft).toBeUndefined();
    expect(bridge.store.getState().entities.item[ID]?.status).toBe("handed_off");
  });

  it("a conflict keeps the draft, reads the prompt again and runs no action", async () => {
    await ready();
    map();
    await A.load(bridge, ID);
    L.patchLocal(ID, { draft: "Mine" });
    refuse("handoff_edit", "conflict");
    const seen = sent();
    await A.copy(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_edit", "handoff_get"]);
    expect(L.localOf(ID)).toMatchObject({ draft: "Mine", error: "The prompt changed since. Your edit is kept; save it again." });
    expect(L.localOf(ID).pending).toBeUndefined();
  });

  it("an empty draft is refused and kept", async () => {
    await ready();
    await A.load(bridge, ID);
    L.patchLocal(ID, { draft: " " });
    expect(await A.flushDraft(bridge, ID)).toBe(false);
    expect(L.localOf(ID).error).toBe("The prompt can't be empty.");
  });

  it("nothing unsaved needs no edit", async () => {
    await ready();
    await A.load(bridge, ID);
    L.patchLocal(ID, { draft: A.viewOf(bridge, ID)!.prompt_md! });
    const seen = sent();
    expect(await A.flushDraft(bridge, ID)).toBe(true);
    expect(seen).toEqual([]);
  });

  it("Copy Prompt shows Copied for two seconds and hands the item off without launching", async () => {
    await ready(false);
    await A.load(bridge, ID);
    vi.useFakeTimers();
    const seen = sent();
    await A.copy(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_copy"]);
    expect(L.localOf(ID).copied).toBe(true);
    expect(bridge.store.getState().entities.item[ID]).toMatchObject({ status: "handed_off", review: "accepted" });
    vi.advanceTimersByTime(2000);
    expect(L.localOf(ID).copied).toBeUndefined();
  });

  it("one action runs at a time", async () => {
    await ready();
    map();
    await A.load(bridge, ID);
    const seen = sent();
    await Promise.all([A.open(bridge, ID), A.open(bridge, ID), A.copy(bridge, ID)]);
    expect(seen.map((s) => s[0])).toEqual(["handoff_open"]);
  });

  it("a launch that fails marks nothing and keeps the reason; an unmapped repository reads the plan again", async () => {
    await ready();
    fake.world.repos.mappings.length = 0;
    await A.load(bridge, ID);
    const seen = sent();
    await A.open(bridge, ID);
    expect(seen.map((s) => s[0])).toEqual(["handoff_open", "handoff_get"]);
    expect(L.localOf(ID)).toMatchObject({ openFailed: "repo_not_mapped" });
    expect(L.localOf(ID).opened).toBeUndefined();
    expect(bridge.store.getState().entities.item[ID]?.status).not.toBe("handed_off");
    map();
    refuse("handoff_open", "automation_denied");
    await A.open(bridge, ID);
    expect(L.localOf(ID).openFailed).toBe("automation_denied");
  });

  it("Codex changes the target the core holds", async () => {
    await ready();
    map();
    await A.load(bridge, ID);
    await A.setTarget(bridge, ID, "codex");
    expect(A.viewOf(bridge, ID)).toMatchObject({ target: "codex", launch: { path: "terminal" } });
  });

  it("a refused copy names its error and marks nothing", async () => {
    await ready();
    await A.load(bridge, ID);
    refuse("handoff_copy", "prompt_not_ready");
    await A.copy(bridge, ID);
    expect(L.localOf(ID).error).toBe("Couldn't finish that. Try again.");
    expect(L.localOf(ID).copied).toBeUndefined();
  });
});
