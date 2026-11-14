// The item commands against the real bridge and the fake core: what each sends, what the row then shows and keeps.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { resetUndo, useUndo, undoLast, undoMode } from "../history/undo";
import { answerHandoff, create, loadItems, reopen, review, reviewAll, saveDraft, setDone, undoRow } from "./actions";
import { localOf, resetLocal, patchLocal } from "./local";
import { draftOf } from "./review";

// The undo strip's hook is a thin useSyncExternalStore over module state: read it without React.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));

let bridge: Bridge;
let fake: FakeCore;
beforeEach(() => (resetLocal(), resetUndo()));
afterEach(() => bridge.close());

async function ready() {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const item = (id: string) => bridge.store.getState().entities.item[id] ?? fake.world.items.find((i) => i.id === id)!;
const CONFLICT = "Item changed since you opened it. Check the current text and save again.";

describe("loadItems", () => {
  it("reads items_list for the call and puts every row in the store", async () => {
    await ready();
    const seen = sent();
    const rows = await loadItems(bridge, "call_live");
    expect(seen).toContainEqual(["items_list", { filter: { call_id: "call_live" }, page: {} }]);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(bridge.store.getState().entities.item["itm_replay"]).toBeDefined();
  });

  it("follows the page cursors", async () => {
    await ready();
    const pages = [{ rows: [fake.world.items[0]!], next_cursor: "c1", total: 2 }, { rows: [fake.world.items[1]!], next_cursor: null, total: 2 }];
    const args: unknown[] = [];
    bridge.core.itemsList = (async (a: unknown) => (args.push(a), { status: "ok", data: pages.shift() })) as never;
    expect(await loadItems(bridge, "call_live")).toHaveLength(2);
    expect(args[1]).toMatchObject({ page: { cursor: "c1" } });
  });
});

describe("review (flow inst-accept, inst-reject, inst-restore, inst-error)", () => {
  it("accept sends the current rev and shows Accepted for 4 s with the change to undo", async () => {
    await ready();
    const seen = sent();
    const r = await review(bridge, item("itm_replay"), "accept");
    expect(r.status).toBe("ok");
    expect(seen).toContainEqual(["item_review", { item_id: "itm_replay", rev: 1, decision: "accept" }]);
    expect(item("itm_replay").review).toBe("accepted");
    expect(localOf("itm_replay").outcome).toMatchObject({ text: "Accepted", ms: 4000, target: { type: "change" } });
  });

  it("reject shows Rejected · Undo for 10 s", async () => {
    await ready();
    await review(bridge, item("itm_replay"), "reject");
    expect(localOf("itm_replay").outcome).toMatchObject({ text: "Rejected", ms: 10_000 });
    expect(undoMode()).toBe("undo");
  });

  it("restore returns the row to Suggested with no outcome", async () => {
    await ready();
    await review(bridge, item("itm_replay"), "reject");
    await review(bridge, item("itm_replay"), "restore");
    expect(item("itm_replay").review).toBe("suggested");
    expect(localOf("itm_replay").outcome).toBeUndefined();
    expect(undoMode()).toBe("undo");
  });

  it("a refused review keeps the row Suggested, shows no success and reads the item again on a conflict", async () => {
    await ready();
    const stale = { ...item("itm_replay"), rev: 0 };
    const seen = sent();
    const r = await review(bridge, stale, "accept");
    expect(r.status).toBe("error");
    expect(localOf("itm_replay").error).toBe(CONFLICT);
    expect(localOf("itm_replay").outcome).toBeUndefined();
    expect(seen.map((s) => s[0])).toContain("item_get");
  });
});

describe("reviewAll (flow inst-all, inst-batch)", () => {
  it("sends the call and the kinds, and holds one batch Undo counting the returned items", async () => {
    await ready();
    const seen = sent();
    const r = await reviewAll(bridge, "call_live", []);
    expect(r.status).toBe("ok");
    expect(seen).toContainEqual(["items_review_all", { call_id: "call_live", kinds: [] }]);
    expect(item("itm_replay").review).toBe("accepted");
    expect(useUndo()).toMatchObject({ message: "Accepted 3 suggested items", target: { type: "batch" } });
  });

  it("sends only the kinds of the section, and shows no Undo when nothing was accepted", async () => {
    await ready();
    const seen = sent();
    await reviewAll(bridge, "call_live", ["decision"]);
    expect(seen).toContainEqual(["items_review_all", { call_id: "call_live", kinds: ["decision"] }]);
    expect(useUndo()).toBeNull();
  });

  it("a refused batch shows no Undo", async () => {
    await ready();
    bridge.core.itemsReviewAll = (async () => ({ status: "error", error: { code: "internal", retryable: true } })) as never;
    expect((await reviewAll(bridge, "call_live", [])).status).toBe("error");
    expect(useUndo()).toBeNull();
  });
});

describe("setDone, answerHandoff, reopen", () => {
  it("ticking sends the wanted state; a suggestion becomes Accepted and done", async () => {
    await ready();
    const seen = sent();
    await setDone(bridge, item("itm_replay"), true);
    expect(seen).toContainEqual(["item_set_done", { item_id: "itm_replay", rev: 1, done: true }]);
    expect(localOf("itm_replay").outcome).toMatchObject({ text: "Accepted and done", ms: 10_000 });
    await setDone(bridge, item("itm_spec"), true);
    expect(localOf("itm_spec").outcome?.text).toBe("Done");
  });

  it("keeps a completed suggestion's change whole: Undo restores status, review and done_at, Redo reapplies them", async () => {
    await ready();
    await setDone(bridge, item("itm_replay"), true);
    const target = localOf("itm_replay").outcome!.target!;
    await undoRow(bridge, "itm_replay", target);
    expect(item("itm_replay")).toMatchObject({ status: "open", review: "suggested", done_at: null });
    await bridge.core.changeRedo({ target });
    expect(fake.world.items.find((i) => i.id === "itm_replay")).toMatchObject({ status: "done", review: "accepted" });
  });

  it("unticking sends done false and shows no outcome", async () => {
    await ready();
    await setDone(bridge, item("itm_spec"), true);
    await setDone(bridge, item("itm_spec"), false);
    expect(item("itm_spec").status).toBe("open");
    expect(localOf("itm_spec").outcome).toBeUndefined();
  });

  it("cpt-noter-flow-ui-items-status: ignores a second completion while waiting, then permits an untick", async () => {
    await ready();
    const run = bridge.core.itemSetDone;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const invoke = vi.spyOn(bridge.core, "itemSetDone").mockImplementation(async (args) => {
      await waiting;
      return run(args);
    });
    const completing = setDone(bridge, item("itm_spec"), true);
    const duplicate = setDone(bridge, item("itm_spec"), false);
    const submissions = invoke.mock.calls.length;
    release();
    await Promise.all([completing, duplicate]);
    expect(submissions).toBe(1);
    expect(localOf("itm_spec").outcome?.text).toBe("Done");
    await setDone(bridge, item("itm_spec"), false);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(item("itm_spec").status).toBe("open");
    expect(localOf("itm_spec").outcome).toBeUndefined();
  });

  it("cpt-noter-flow-ui-items-status: a refused pending completion retains its conflict and allows a new attempt", async () => {
    await ready();
    const run = bridge.core.itemSetDone;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(bridge.core, "itemSetDone").mockImplementationOnce(async (args) => {
      await waiting;
      fake.failNext("item_set_done", "conflict");
      return run(args);
    });
    const completing = setDone(bridge, item("itm_spec"), true);
    await setDone(bridge, item("itm_spec"), false);
    await setDone(bridge, item("itm_replay"), true);
    expect(item("itm_replay").status).toBe("done");
    release();
    await completing;
    expect(localOf("itm_spec").error).toBe(CONFLICT);
    expect(localOf("itm_spec").outcome).toBeUndefined();
    expect(bridge.store.getState().commands["item:done:itm_spec"]?.state).toBe("ERROR");
    await setDone(bridge, item("itm_spec"), true);
    expect(localOf("itm_spec").error).toBeUndefined();
    expect(item("itm_spec").status).toBe("done");
  });

  it("Yes, Landed completes the item; Keep Open sends keep_open and keeps it handed off", async () => {
    await ready();
    const seen = sent();
    await answerHandoff(bridge, item("itm_virt"), "keep_open");
    expect(seen).toContainEqual(["item_answer_handoff_landed", { item_id: "itm_virt", rev: 1, answer: "keep_open" }]);
    expect(item("itm_virt").status).toBe("handed_off");
    expect(localOf("itm_virt").asking).toBeUndefined();
    await answerHandoff(bridge, item("itm_virt"), "landed");
    expect(item("itm_virt").status).toBe("done");
    expect(localOf("itm_virt").outcome?.text).toBe("Done");
  });

  it("Reopen sends the rev and shows Reopened", async () => {
    await ready();
    const seen = sent();
    await reopen(bridge, item("itm_token"));
    expect(seen).toContainEqual(["item_reopen", { item_id: "itm_token", rev: 1 }]);
    expect(localOf("itm_token").outcome?.text).toBe("Reopened");
    expect(undoMode()).toBe("undo");
  });

  it("a failed command keeps the previous view and names the error", async () => {
    await ready();
    await reopen(bridge, { ...item("itm_token"), rev: 0 });
    expect(item("itm_token").status).toBe("closed_by_evidence");
    expect(localOf("itm_token").error).toBe(CONFLICT);
  });
});

describe("create (flow inst-create)", () => {
  it("adds an accepted action item with the trimmed text and no owner", async () => {
    await ready();
    const seen = sent();
    const r = await create(bridge, "call_live", "  Send the spec  ");
    expect(r?.status).toBe("ok");
    expect(seen).toContainEqual(["item_create", { call_id: "call_live", kind: "action_item", text: "Send the spec" }]);
  });

  it("empty text sends nothing", async () => {
    await ready();
    const seen = sent();
    expect(await create(bridge, "call_live", "   ")).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe("saveDraft (algo save)", () => {
  const changed = (id: string, o: Partial<ReturnType<typeof draftOf>>) => ({ ...draftOf(item(id)), ...o });

  it("inline review: edit with only the changed fields, then accept with the new rev, Saved and accepted", async () => {
    await ready();
    const seen = sent();
    expect(await saveDraft(bridge, item("itm_a11y"), changed("itm_a11y", { owner: "per_you" }), true)).toBe("ok");
    expect(seen.map((s) => s[0])).toEqual(["item_edit", "item_review"]);
    expect(seen[0]![1]).toEqual({ item_id: "itm_a11y", rev: 1, patch: { owner: { type: "set", person: { type: "existing", person_id: "per_you" } } } });
    expect(seen[1]![1]).toEqual({ item_id: "itm_a11y", rev: 2, decision: "accept" });
    expect(localOf("itm_a11y")).toMatchObject({ outcome: { text: "Saved and accepted", ms: 4000 } });
    expect(localOf("itm_a11y").draft).toBeUndefined();
    expect(localOf("itm_a11y").phase).toBeUndefined();
  });

  it("an untouched draft sends no edit; accepting still happens", async () => {
    await ready();
    const seen = sent();
    await saveDraft(bridge, item("itm_a11y"), draftOf(item("itm_a11y")), true);
    expect(seen.map((s) => s[0])).toEqual(["item_review"]);
  });

  it("inspector save: edit only, Saved for 2 s, never accepts", async () => {
    await ready();
    const seen = sent();
    expect(await saveDraft(bridge, item("itm_a11y"), changed("itm_a11y", { text: "New text" }), false)).toBe("ok");
    expect(seen.map((s) => s[0])).toEqual(["item_edit"]);
    expect(item("itm_a11y")).toMatchObject({ text: "New text", review: "suggested" });
    expect(localOf("itm_a11y").outcome).toMatchObject({ text: "Saved", ms: 2000 });
    expect(undoMode()).toBe("undo");
  });

  it("empty text sends nothing and keeps the draft", async () => {
    await ready();
    const seen = sent();
    expect(await saveDraft(bridge, item("itm_a11y"), changed("itm_a11y", { text: " " }), true)).toBe("invalid");
    expect(seen).toEqual([]);
    expect(localOf("itm_a11y").error).toBe("Enter some text for the item.");
  });

  it("a conflict keeps the draft and the editing phase, and reads the item again", async () => {
    await ready();
    const seen = sent();
    const d = changed("itm_a11y", { text: "Mine" });
    expect(await saveDraft(bridge, { ...item("itm_a11y"), rev: 0 }, d, true)).toBe("conflict");
    expect(localOf("itm_a11y")).toMatchObject({ phase: "editing", draft: d, error: CONFLICT });
    expect(seen.map((s) => s[0]).filter((c) => c !== "log_ui")).toEqual(["item_edit", "item_get"]);
  });

  it("another error keeps the draft", async () => {
    await ready();
    bridge.core.itemEdit = (async () => ({ status: "error", error: { code: "internal", retryable: true } })) as never;
    expect(await saveDraft(bridge, item("itm_a11y"), changed("itm_a11y", { text: "Mine" }), true)).toBe("failed");
    expect(localOf("itm_a11y")).toMatchObject({ phase: "editing", error: "Couldn't finish that. Try again." });
  });

  it("acceptance failing after the edit keeps the saved edit, Suggested, with retry for the acceptance only", async () => {
    await ready();
    bridge.core.itemReview = (async () => ({ status: "error", error: { code: "internal", retryable: true } })) as never;
    expect(await saveDraft(bridge, item("itm_a11y"), changed("itm_a11y", { text: "Saved text" }), true)).toBe("partial");
    expect(item("itm_a11y")).toMatchObject({ text: "Saved text", review: "suggested" });
    expect(localOf("itm_a11y")).toMatchObject({ retryAccept: true, error: "Saved, but it could not be accepted. Try Accept again." });
    expect(localOf("itm_a11y").phase).toBeUndefined();
  });
});

describe("undoRow", () => {
  it("undoes the returned change and reads the item again", async () => {
    await ready();
    await review(bridge, item("itm_replay"), "reject");
    const target = localOf("itm_replay").outcome!.target!;
    const seen = sent();
    await undoRow(bridge, "itm_replay", target);
    expect(seen.map((s) => s[0])).toEqual(["change_undo", "item_get"]);
    expect(seen[0]![1]).toEqual({ target });
    expect(localOf("itm_replay").outcome).toBeUndefined();
  });

  it("a refused undo names the error", async () => {
    await ready();
    bridge.core.changeUndo = (async () => ({ status: "error", error: { code: "edited_later", retryable: false } })) as never;
    await undoRow(bridge, "itm_replay", { type: "change", change_id: "chg_x" });
    expect(localOf("itm_replay").error).toBe("Couldn't finish that. Try again.");
  });
});

it("keeps a completed suggestion's change for Done today and Cmd-Z after feedback expires", async () => {
  await ready();
  await setDone(bridge, item("itm_replay"), true);
  const target = localOf("itm_replay").outcome!.target;
  patchLocal("itm_replay", { outcome: undefined });
  expect(localOf("itm_replay").doneTarget).toEqual(target);
  expect(useUndo()?.target).toEqual(target);
  await undoLast(bridge);
  expect(item("itm_replay").review).toBe("suggested");
  expect(item("itm_replay").status).toBe("open");
  expect(localOf("itm_replay").doneTarget).toBeUndefined();
});

it("inline completion Undo switches History to Redo instead of retaining an already-undone target", async () => {
  await ready();
  await setDone(bridge, item("itm_spec"), true);
  const target = localOf("itm_spec").doneTarget!;
  await undoRow(bridge, "itm_spec", target);
  expect(undoMode()).toBe("redo");
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
