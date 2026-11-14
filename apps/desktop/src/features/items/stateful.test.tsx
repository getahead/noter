// The stateful closures of Add Action Item and the Item inspector (SSR does not run effects or keep state): React's
// useState and useEffect are replaced so the handlers run against a given state.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queue: unknown[][] = [];
const effects: Array<() => void> = [];
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: (init: unknown) => queue.shift() ?? [typeof init === "function" ? (init as () => unknown)() : init, () => {}],
  useEffect: (f: () => (() => void) | void) => void effects.push(() => void f()),
}));

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { AddItem } from "./AddItem";
import { ItemInspector } from "./ItemInspector";
import { resetLocal } from "./local";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(async () => {
  resetLocal();
  queue.length = 0;
  effects.length = 0;
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
});
afterEach(() => (vi.useRealTimers(), bridge.close()));
const settle = () => new Promise((r) => setTimeout(r));

describe("AddItem", () => {
  it("Return adds the text and closes; an empty one shows its error; Esc closes", async () => {
    const setText = vi.fn();
    const setError = vi.fn();
    queue.push(["Send it", setText], [null, setError]);
    const tree = rendered(AddItem, { bridge, callId: "call_live" });
    (find(tree, (p) => typeof p.onEnter === "function").props.onEnter as () => void)();
    await settle();
    expect(setText).toHaveBeenCalledWith(null);
    queue.push(["  ", setText], [null, setError]);
    const empty = rendered(AddItem, { bridge, callId: "call_live" });
    (find(empty, (p) => p.label === "Add" && typeof p.onAction === "function").props.onAction as () => void)();
    await settle();
    expect(setError).toHaveBeenCalledWith("Enter some text for the item.");
    (empty.props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation() {} });
    expect(setText).toHaveBeenCalledWith(null);
  });

  it("the closed form offers Add Action Item, which opens the field", () => {
    const setText = vi.fn();
    queue.push([null, setText], [null, vi.fn()]);
    const tree = rendered(AddItem, { bridge, callId: "call_live" });
    (tree.props.onAction as () => void)();
    expect(setText).toHaveBeenCalledWith("");
  });
});

describe("ItemInspector", () => {
  const stored = () => bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: { itm_a11y: fake.world.items.find((i) => i.id === "itm_a11y")! } } }));

  it("ignores keyboard submission while a save is pending", async () => {
    stored();
    const invoke = vi.spyOn(fake, "invoke");
    queue.push(["details", vi.fn()], [null, vi.fn()], [false, vi.fn()], [{ text: "Pending draft", due: "", linked_issue: "" }, vi.fn()], ["saving", vi.fn()]);
    const tree = rendered(ItemInspector, { bridge, itemId: "itm_a11y" });
    (find(tree, (p) => p.className === "ii-details").props.onKeyDown as (e: unknown) => void)({ key: "Enter", metaKey: true, preventDefault() {} });
    await settle();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads the item on mount, saves the draft and clears the Saved status after 2 s", async () => {
    vi.useFakeTimers();
    const [setEvidence, setLoadError, setDraft, setSaved] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    stored();
    queue.push(["details", vi.fn()], [null, setEvidence], [false, setLoadError], [{ text: "Changed", due: "", linked_issue: "" }, setDraft], ["saved", setSaved]);
    const tree = rendered(ItemInspector, { bridge, itemId: "itm_a11y" });
    effects.forEach((e) => e());
    await vi.advanceTimersByTimeAsync(2100);
    expect(setEvidence).toHaveBeenCalled();
    expect(setSaved).toHaveBeenCalledWith("idle");
    (find(tree, (p) => p.label === "Save" && typeof p.onAction === "function").props.onAction as () => void)();
    await vi.advanceTimersByTimeAsync(10);
    expect(setSaved).toHaveBeenCalledWith("saving");
    expect(setDraft).toHaveBeenCalledWith(null);
  });

  it("an unreadable item offers Try Again", async () => {
    const setLoadError = vi.fn();
    queue.push(["details", vi.fn()], [null, vi.fn()], [true, setLoadError], [null, vi.fn()], ["idle", vi.fn()]);
    const tree = rendered(ItemInspector, { bridge, itemId: "itm_none" });
    effects.forEach((e) => e());
    await settle();
    expect(setLoadError).toHaveBeenCalledWith(true);
    (find(tree, (p) => p.label === "Try Again" && typeof p.onAction === "function").props.onAction as () => void)();
    await settle();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
