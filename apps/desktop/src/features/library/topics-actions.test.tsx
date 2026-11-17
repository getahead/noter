import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { resetUndo } from "../history/undo";
import { MergeSheet } from "./MergeSheet";
import { RenameSheet } from "./RenameSheet";
import { ThreadView, threadActions } from "./ThreadPage";
import { createSheets } from "../../ui/dialogs/sheets";
import { keepSeparate, mergeTopic, renameTopic } from "./topics-actions";
import { clashOf, itemsOf } from "./topics-model";

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
    const out = await renameTopic(bridge, a!, "Brand new name", [a!, b!], () => {});
    expect(out).toMatchObject({ type: "renamed", topic: { name: "Brand new name" } });
  });
  it("a stale revision and a failed write keep the draft", async () => {
    const [a, b] = await ready();
    expect(await renameTopic(bridge, { ...a!, rev: a!.rev + 5 }, "Other", [a!, b!], () => {})).toEqual({ type: "stale" });
    expect(await renameTopic(bridge, { ...a!, id: "top_missing" }, "Other", [a!, b!], () => {})).toEqual({ type: "failed" });
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
    expect(itemsOf([{ call: {} as never, items: [{}, {}] as never }, { call: {} as never, items: [{}] as never }])).toBe(3);
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
  it("MergeSheet excludes the source from the chooser and lists what moves", async () => {
    const [a, b] = await ready();
    const h = renderToString(<MergeSheet bridge={bridge} source={a!} known={[a!, b!]} onMerged={() => {}} close={() => {}} />);
    expect(h).toContain(b!.name);
    expect(h).toContain("Merge into");
    expect(h).toContain("What moves");
    expect(h).not.toContain(`value="${a!.id}"`);
    const merged = vi.fn();
    const tree = rendered(MergeSheet as never, { bridge, source: a!, known: [a!, b!], onMerged: merged, close: () => {} } as never);
    (find(tree, (p) => "onDefault" in p).props.onDefault as () => void)();
    await settle();
  });
});

describe("thread actions", () => {
  it("draws Rename…, Merge With… and the suggestion with Merge and Keep Separate", async () => {
    const [a, b] = await ready();
    const topic = { ...a!, merge_suggestion: { id: b!.id, name: b!.name } };
    const actions = { rename: vi.fn(), merge: vi.fn(), keepSeparate: vi.fn() };
    const h = renderToString(<ThreadView bridge={bridge} status="READY" retry={() => {}} data={{ topic, groups: [] }} months={[]} actions={actions} />);
    expect(h).toContain("Rename…");
    expect(h).toContain("Merge With…");
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
    expect((await run({ ...a!, rev: a!.rev + 9 })).onRenamed).toHaveBeenCalled();
    expect((await run({ ...a!, name: " " })).close).not.toHaveBeenCalled();
  });
  it("Merge closes and reports the kept topic", async () => {
    const [a, b] = await ready();
    const onMerged = vi.fn();
    const close = vi.fn();
    const tree = rendered(MergeSheet as never, { bridge, source: a!, target: b!.id, known: [a!, b!], onMerged, close } as never);
    await (find(tree, (p) => "onDefault" in p).props.onDefault as () => Promise<void>)();
    await settle();
    expect(onMerged).toHaveBeenCalledWith(expect.objectContaining({ id: b!.id }));
    expect(close).toHaveBeenCalled();
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
});
