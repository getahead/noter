import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { resetUndo } from "../history/undo";
import { MergeSheet, Moves } from "./MergeSheet";
import { RenameSheet } from "./RenameSheet";
import { ThreadView, threadActions } from "./ThreadPage";
import { createSheets } from "../../ui/dialogs/sheets";
import { confirmMerge, keepSeparate, mergeTopic, renameTopic } from "./topics-actions";
import { clashOf, movesOf } from "./topics-model";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => (resetUndo(), bridge.close()));
async function ready() {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  return fake.world.topics;
}
const settle = () => new Promise((r) => setTimeout(r));

describe("topic actions (cpt-noter-flow-ui-library-search-topics-topic)", () => {
  it("renames, refusing a blank and a taken name before the core", async () => {
    const [a, b] = await ready();
    const act = vi.spyOn(bridge, "act");
    expect(await renameTopic(bridge, a!, "  ", [a!, b!], () => {})).toEqual({ type: "blank" });
    expect(await renameTopic(bridge, a!, b!.name.toUpperCase(), [a!, b!], () => {})).toMatchObject({ type: "clash", other: { id: b!.id } });
    expect(act).not.toHaveBeenCalled();
    // #1047: the page that asked (the thread's heading, the table) rereads once the name is saved
    const refresh = vi.fn();
    const out = await renameTopic(bridge, a!, "Brand new name", [a!, b!], refresh);
    expect(out).toMatchObject({ type: "renamed", topic: { name: "Brand new name" } });
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("a stale revision re-reads the topic and retries once with the fresh revision, keeping only the typed name", async () => {
    const [a, b] = await ready();
    const rename = vi.spyOn(bridge.core, "topicRename");
    const rev = a!.rev;
    const out = await renameTopic(bridge, { ...a!, rev: rev + 5 }, "Other", [a!, b!], () => {});
    expect(out).toMatchObject({ type: "renamed", topic: { id: a!.id, name: "Other" } });
    expect(rename.mock.calls.map((c) => [c[0].rev, c[0].name])).toEqual([[rev + 5, "Other"], [rev, "Other"]]);
  });
  it("a conflict that persists after the re-read stays stale, and a failed write keeps the draft", async () => {
    const [a, b] = await ready();
    fake.failNext("topic_rename", "conflict", null);
    fake.failNext("topic_rename", "conflict", null);
    expect(await renameTopic(bridge, a!, "Other", [a!, b!], () => {})).toEqual({ type: "stale" });
    expect(await renameTopic(bridge, { ...a!, id: "top_missing" }, "Other", [a!, b!], () => {})).toEqual({ type: "failed" });
  });
  it("a core duplicate refusal names the other topic from a fresh list, never this topic itself", async () => {
    const [a, b] = await ready();
    const dup = { type: "validation", field: "name", rule: "duplicate" } as never;
    fake.failNext("topic_rename", "invalid_input", dup);
    expect(await renameTopic(bridge, a!, "Brand new name", [a!], () => {})).toEqual({ type: "failed" });
    fake.failNext("topic_rename", "invalid_input", dup);
    expect(await renameTopic(bridge, a!, b!.name, [], () => {})).toMatchObject({ type: "clash", other: { id: b!.id } });
  });
  it("merges only the chosen pair and keeps topics separate", async () => {
    const [a, b] = await ready();
    expect(await keepSeparate(bridge, a!.id, b!.id)).toBe(true);
    expect(await keepSeparate(bridge, a!.id, a!.id)).toBe(false);
    expect(await mergeTopic(bridge, a!.id, a!.id, 0, () => {})).toBeNull();
    expect(await mergeTopic(bridge, a!.id, b!.id, 2, () => {})).toMatchObject({ id: b!.id });
  });
  it("finds a name clash ignoring case and itself, and counts the moving items", async () => {
    const [a, b] = await ready();
    expect(clashOf([a!, b!], a!.id, ` ${a!.name} `)).toBeNull();
    expect(clashOf([a!, b!], a!.id, b!.name.toLowerCase())?.id).toBe(b!.id);
    expect(movesOf([{ call: {} as never, items: [{ id: 1 }, { id: 2 }] as never }, { call: {} as never, items: [] }, { call: {} as never, items: [{ id: 3 }] as never }])).toMatchObject({ calls: 2, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  });
});

describe("rename and merge sheets (cpt-noter-state-ui-library-search-topics-view)", () => {
  it("RenameSheet shows the current name and renames on Rename", async () => {
    const [a, b] = await ready();
    const onRenamed = vi.fn();
    const close = vi.fn();
    const props = { bridge, topic: a!, known: [a!, b!], onRenamed, onMergeInstead: vi.fn(), close };
    expect(renderToString(<RenameSheet {...props} />)).toContain(a!.name);
    const tree = rendered(RenameSheet as never, props as never);
    (find(tree, (p) => p.label === "Cancel").props.onAction as () => void)();
    expect(close).toHaveBeenCalled();
  });
  it("Moves lists each item's kind and text with the counts, or says only an alias moves", () => {
    const item = (id: string, kind: string, text: string) => ({ id, kind, text }) as never;
    const h = renderToString(<Moves groups={[{ call: {} as never, items: [item("1", "decision", "Use websockets"), item("2", "risk", "Reconnect storms")] }]} />);
    expect(h).toContain("What moves · 2 items from 1 call");
    expect(h).toContain("Use websockets");
    expect(h).toContain("Reconnect storms");
    expect(renderToString(<Moves groups={[]} />)).toContain("Nothing moves");
  });
  it("MergeSheet excludes the source from the chooser and lists what moves", async () => {
    const [a, b] = await ready();
    const h = renderToString(<MergeSheet bridge={bridge} source={a!} known={[a!, b!]} onMerged={() => {}} close={() => {}} />);
    expect(h).toContain(b!.name);
    expect(h).toContain("Merge into");
    expect(h).toContain("Reading what moves");
    expect(h).not.toContain(`value="${a!.id}"`);
    const merged = vi.fn();
    const tree = rendered(MergeSheet as never, { bridge, source: a!, known: [a!, b!], onMerged: merged, close: () => {} } as never);
    (find(tree, (p) => "onDefault" in p).props.onDefault as () => void)();
    await settle();
    expect(merged).not.toHaveBeenCalled(); // nothing merges before the read says what moves
  });
  it("MergeSheet says it is reading, never counts 0 before the read, and cannot merge when the read failed", async () => {
    const [a, b] = await ready();
    const props = { bridge, source: a!, known: [a!, b!], onMerged: vi.fn(), close: () => {} };
    const h = renderToString(<MergeSheet {...props} />);
    expect(h).toContain(`Merge “${a!.name}” into “${b!.name}”?`);
    expect(h).toContain("Reading what moves");
    expect(h).not.toContain("Nothing moves");
    fake.failNext("topic_get", "internal", null);
    const tree = rendered(MergeSheet as never, props as never);
    await settle();
    await (find(tree, (p) => "onDefault" in p).props.onDefault as () => Promise<void>)();
    await settle();
    expect(props.onMerged).not.toHaveBeenCalled();
  });
});

describe("thread actions", () => {
  it("draws the suggestion with Merge and Keep Separate (Rename… and Merge With… live in the toolbar ⋯ menu)", async () => {
    const [a, b] = await ready();
    const topic = { ...a!, merge_suggestion: { id: b!.id, name: b!.name } };
    const actions = { rename: vi.fn(), merge: vi.fn(), keepSeparate: vi.fn() };
    const h = renderToString(<ThreadView bridge={bridge} status="READY" retry={() => {}} data={{ topic, groups: [] }} months={[]} actions={actions} />);
    expect(h).not.toContain("Rename…");
    expect(h).toContain("Keep Separate");
    expect(h).toContain(`Looks like the same subject as “${b!.name}”`);
  });
});

describe("sheet flows and thread actions", () => {
  it("Rename closes on success, names a clash, a stale revision and a blank", async () => {
    const [a, b] = await ready();
    const run = async (topic: typeof a, extra = {}) => {
      const close = vi.fn();
      const onRenamed = vi.fn();
      const tree = rendered(RenameSheet as never, { bridge, topic, known: [a!, b!], onRenamed, onMergeInstead: vi.fn(), close, ...extra } as never);
      await (find(tree, (p) => "onDefault" in p).props.onDefault as () => Promise<void>)();
      await settle();
      return { close, onRenamed };
    };
    expect((await run(a)).close).toHaveBeenCalled();
    expect((await run({ ...a!, name: b!.name })).close).not.toHaveBeenCalled();
    expect((await run({ ...a!, rev: a!.rev + 9 })).close).toHaveBeenCalled(); // a stale revision saves after the re-read
    fake.failNext("topic_rename", "conflict", null);
    fake.failNext("topic_rename", "conflict", null);
    const still = await run({ ...a! });
    expect(still.close).not.toHaveBeenCalled(); // a conflict that persists keeps the draft and re-reads the page
    expect(still.onRenamed).toHaveBeenCalled();
    expect((await run({ ...a!, name: " " })).close).not.toHaveBeenCalled();
  });
  it("confirmMerge waits for the read, refuses the same topic, then merges and counts what moved", async () => {
    const [a, b] = await ready();
    const groups = [{ call: {} as never, items: [{}, {}] as never }];
    expect(await confirmMerge(bridge, a!.id, b!.id, undefined, () => {})).toBeUndefined();
    expect(await confirmMerge(bridge, a!.id, b!.id, null, () => {})).toBeUndefined();
    expect(await confirmMerge(bridge, a!.id, a!.id, groups, () => {})).toBeUndefined();
    expect(await confirmMerge(bridge, a!.id, "", groups, () => {})).toBeUndefined();
    expect(await confirmMerge(bridge, a!.id, b!.id, groups, () => {})).toMatchObject({ id: b!.id });
    expect(await confirmMerge(bridge, "top_missing", b!.id, groups, () => {})).toBeNull();
  });
  it("Merge hands the Undo its refresh and reports the kept topic", async () => {
    const [a, b] = await ready();
    const refresh = vi.fn();
    expect(await mergeTopic(bridge, a!.id, b!.id, 1, refresh)).toMatchObject({ id: b!.id });
  });
  it("the thread's buttons open the sheets and Keep Separate asks the core", async () => {
    const [a, b] = await ready();
    const sheets = createSheets();
    const open = vi.spyOn(sheets, "open");
    const retry = vi.fn();
    const topic = { ...a!, merge_suggestion: { id: b!.id, name: b!.name } };
    const acts = threadActions(sheets, bridge, topic, [a!, b!], retry);
    acts.rename();
    acts.merge();
    expect(open).toHaveBeenNthCalledWith(1, "topic-rename", expect.objectContaining({ topic }));
    expect(open).toHaveBeenNthCalledWith(2, "topic-merge", expect.objectContaining({ target: b!.id }));
    const props = open.mock.calls[0]![1] as { onMergeInstead: (t: unknown) => void };
    props.onMergeInstead(b);
    expect(open).toHaveBeenCalledTimes(3);
    acts.keepSeparate();
    await settle();
    expect(retry).toHaveBeenCalled();
    threadActions(sheets, bridge, a!, [a!], retry).keepSeparate();
  });
  it("a refused Keep Separate is reported, and the Merge sheet's Undo re-reads the page", async () => {
    const [a, b] = await ready();
    const topic = { ...a!, merge_suggestion: { id: b!.id, name: b!.name } };
    const sheets = createSheets();
    const open = vi.spyOn(sheets, "open");
    const failed = vi.fn();
    const retry = vi.fn();
    fake.failNext("topics_keep_separate", "internal", null);
    const acts = threadActions(sheets, bridge, topic, [a!, b!], retry, failed);
    acts.keepSeparate();
    await settle();
    expect(failed).toHaveBeenLastCalledWith(true);
    expect(retry).not.toHaveBeenCalled();
    acts.merge();
    expect(open).toHaveBeenCalledWith("topic-merge", expect.objectContaining({ refresh: retry }));
    const h = renderToString(<ThreadView bridge={bridge} status="READY" retry={() => {}} data={{ topic, groups: [] }} months={[]} actions={acts} keepFailed />);
    expect(h).toContain("Couldn’t keep the topics separate");
  });
});
