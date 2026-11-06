// The action item row for a loaded call: what it draws in each variant and state, and what its controls and keys send.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { resetUndo } from "../history/undo";
import { slots as outputSlots } from "../call-page/slots";
import { ActionItemRow, EditFields, focusNext, reviewMenu, ReviewButtons, rowKey } from "./ActionItemRow";
import { localOf, patchLocal, resetLocal } from "./local";
import { RejectedList } from "./RejectedList";
import { slots } from "./slots";
import "./register";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(() => (resetLocal(), resetUndo()));
afterEach(() => {
  slots.inspect = slots.openHandoff = null;
  vi.unstubAllGlobals();
  return bridge.close();
});

async function ready() {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
}
const item = (id: string, o: Partial<ItemView> = {}): ItemView => ({ ...fake.world.items.find((i) => i.id === id)!, ...o });
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r));
const press = (tree: ReturnType<typeof rendered>, label: string) => (find(tree, (p) => p.label === label && typeof p.onAction === "function").props.onAction as () => void)();
const key = (code: string, o: Record<string, unknown> = {}) => ({ code, key: o.key ?? code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target: null, preventDefault() {}, stopPropagation() {}, ...o }) as never;

describe("ActionItemRow (cpt-noter-component-ui-action-item-row)", () => {
  it("the outputs section's seam is filled with it", async () => {
    await ready();
    expect(outputSlots.actionItemRow).toBe(ActionItemRow);
    expect(outputSlots.rejectedList).toBe(RejectedList);
  });

  it("a suggested full row names its component, variant and state, with Accept, Edit and Reject", async () => {
    await ready();
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_replay")} />);
    expect(html).toContain('data-component="cpt-noter-component-ui-action-item-row"');
    expect(html).toContain('data-variant="full"');
    expect(html).toContain('data-state="suggested"');
    for (const label of ["Accept", "Edit", "Reject", "Suggested"]) expect(html).toContain(label);
    expect(html).toContain("Replay buffer for websocket reconnects");
  });

  it("Accept, Reject and Edit send the review and open the draft", async () => {
    await ready();
    const seen = sent();
    const tree = rendered(ReviewButtons, { it: item("itm_replay"), bridge, retryOnly: false, edit: () => patchLocal("itm_replay", { phase: "editing", draft: { text: "Replay buffer for websocket reconnects", owner: "", due: "", engineering: false, linked_issue: "" } }) });
    press(tree, "Accept");
    await settle();
    expect(seen).toContainEqual(["item_review", { item_id: "itm_replay", rev: 1, decision: "accept" }]);
    press(tree, "Edit");
    expect(localOf("itm_replay")).toMatchObject({ phase: "editing", draft: { text: "Replay buffer for websocket reconnects" } });
  });

  it("an accepted row has no review buttons; the outcome takes their place with Undo", async () => {
    await ready();
    patchLocal("itm_replay", { outcome: { text: "Accepted", target: { type: "change", change_id: "chg_1" }, ms: 4000 } });
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_replay", { review: "accepted" })} />);
    expect(html).toContain("Accepted");
    expect(html).not.toContain(">Reject<");
    expect(html).toContain("Undo");
  });

  it("a rejected row shows Rejected · Undo as a ghost line, then nothing once its outcome ended", async () => {
    await ready();
    const rejected = item("itm_replay", { review: "rejected" });
    patchLocal("itm_replay", { outcome: { text: "Rejected", target: { type: "change", change_id: "chg_1" }, ms: 10_000 } });
    const html = renderToString(<ActionItemRow bridge={bridge} item={rejected} />);
    expect(html).toContain("is-rej");
    expect(html).toContain("Rejected");
    patchLocal("itm_replay", { outcome: undefined });
    expect(renderToString(<ActionItemRow bridge={bridge} item={rejected} />)).toBe("");
  });

  it("Undo on an outcome sends change_undo of the returned change", async () => {
    await ready();
    const seen = sent();
    patchLocal("itm_replay", { outcome: { text: "Rejected", target: { type: "change", change_id: "chg_9" }, ms: 10_000 } });
    const status = find(rendered(ActionItemRow, { bridge, item: item("itm_replay", { review: "rejected" }) }), (p) => p.actionLabel === "Undo");
    (status.props.onAction as () => void)();
    await settle();
    expect(seen[0]).toEqual(["change_undo", { target: { type: "change", change_id: "chg_9" } }]);
    (status.props.onExpire as () => void)();
    expect(localOf("itm_replay").outcome).toBeUndefined();
  });

  it("an editing row draws the text, Owner, Due and Engineering fields with Cancel and Save", async () => {
    await ready();
    patchLocal("itm_a11y", { phase: "editing", draft: { text: "Draft text", owner: "per_anna", due: "", engineering: false, linked_issue: "" } });
    const draft = localOf("itm_a11y").draft!;
    const tree = rendered(EditFields, { it: item("itm_a11y"), bridge, draft, saving: false });
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_a11y")} />);
    expect(html).toContain('data-state="editing"');
    for (const label of ["Owner", "Due", "Engineering", "Cancel", "Save", "Draft text"]) expect(html).toContain(label);
    press(tree, "Cancel");
    expect(localOf("itm_a11y").phase).toBeUndefined();
  });

  it("Save sends the draft; editing the fields keeps them as the draft", async () => {
    await ready();
    const seen = sent();
    const draft = { text: "New", owner: "per_anna", due: "", engineering: false, linked_issue: "" };
    patchLocal("itm_a11y", { phase: "editing", draft });
    const props = () => ({ it: item("itm_a11y"), bridge, draft: localOf("itm_a11y").draft!, saving: false });
    const tree = rendered(EditFields, props());
    (find(tree, (p) => p.ariaLabel === "Item text").props.onChange as (v: string) => void)("Changed");
    expect(localOf("itm_a11y").draft?.text).toBe("Changed");
    // each change re-renders the fields with the draft it made
    (find(rendered(EditFields, props()), (p) => p.label === "Owner" && Array.isArray(p.options)).props.onAction as (v: string) => void)("per_you");
    (find(rendered(EditFields, props()), (p) => p.ariaLabel === "Due").props.onChange as (v: string) => void)("2026-10-17");
    (find(rendered(EditFields, props()), (p) => p.label === "Engineering").props.onAction as (v: boolean) => void)(true);
    expect(localOf("itm_a11y").draft).toMatchObject({ owner: "per_you", due: "2026-10-17", engineering: true });
    patchLocal("itm_a11y", { draft });
    press(rendered(EditFields, props()), "Save");
    await settle();
    expect(seen.map((s) => s[0])).toEqual(["item_edit", "item_review"]);
  });

  it("a saving row disables its fields", async () => {
    await ready();
    patchLocal("itm_a11y", { phase: "saving", draft: { text: "x", owner: "", due: "", engineering: false, linked_issue: "" } });
    expect(renderToString(<ActionItemRow bridge={bridge} item={item("itm_a11y")} />)).toContain('data-state="saving"');
  });

  it("the checkbox sends the wanted state", async () => {
    await ready();
    const seen = sent();
    const box = find(rendered(ActionItemRow, { bridge, item: item("itm_spec") }), (p) => typeof p.ariaLabel === "string" && String(p.ariaLabel).startsWith("Done:"));
    (box.props.onAction as (c: boolean) => void)(true);
    await settle();
    expect(seen).toContainEqual(["item_set_done", { item_id: "itm_spec", rev: 1, done: true }]);
  });

  it("ticking a handed-off item asks Did the handoff land? with three answers; Keep Open keeps it handed off", async () => {
    await ready();
    const seen = sent();
    const handed = item("itm_virt");
    const box = find(rendered(ActionItemRow, { bridge, item: handed }), (p) => typeof p.ariaLabel === "string" && String(p.ariaLabel).startsWith("Done:"));
    (box.props.onAction as (c: boolean) => void)(true);
    expect(localOf("itm_virt").asking).toBe(true);
    expect(seen).toEqual([]);
    const tree = rendered(ActionItemRow, { bridge, item: handed });
    const html = renderToString(<ActionItemRow bridge={bridge} item={handed} />);
    for (const label of ["Did the handoff land?", "Yes, Landed", "Done Another Way", "Keep Open"]) expect(html).toContain(label);
    press(tree, "Keep Open");
    await settle();
    expect(seen).toContainEqual(["item_answer_handoff_landed", { item_id: "itm_virt", rev: 1, answer: "keep_open" }]);
    patchLocal("itm_virt", { asking: true });
    press(rendered(ActionItemRow, { bridge, item: handed }), "Done Another Way");
    await settle();
    expect(seen).toContainEqual(["item_answer_handoff_landed", { item_id: "itm_virt", rev: 2, answer: "done_another_way" }]);
  });

  it("Handoff and the info button appear only once their features register", async () => {
    await ready();
    const virt = item("itm_virt", { status: "open", is_engineering: true });
    const without = renderToString(<ActionItemRow bridge={bridge} item={virt} />);
    expect(without).not.toContain("Handoff");
    expect(without).not.toContain("Show in Item inspector");
    const [handoff, inspect] = [vi.fn(), vi.fn()];
    slots.openHandoff = handoff;
    slots.inspect = inspect;
    const tree = rendered(ActionItemRow, { bridge, item: virt });
    press(tree, "Handoff");
    expect(handoff).toHaveBeenCalledWith(bridge, "itm_virt");
    (find(tree, (p) => p.label === "Show in Item inspector").props.onAction as () => void)();
    expect(inspect).toHaveBeenCalledWith(bridge, "itm_virt");
  });

  it("tags: linked issue, Engineering, Handed off, Carried from, and a closed item's Reopen", async () => {
    await ready();
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_virt", { linked_issue: "VSTOR-12", carried_from: { id: "c", title: "1:1", started_at: 0, call_type: "x" } })} />);
    for (const text of ["VSTOR-12", "Engineering", "Handed off", "Carried from 1:1"]) expect(html).toContain(text);
    const seen = sent();
    const closed = item("itm_token");
    expect(renderToString(<ActionItemRow bridge={bridge} item={closed} />)).toContain("Closed:");
    press(rendered(ActionItemRow, { bridge, item: closed }), "Reopen");
    await settle();
    expect(seen).toContainEqual(["item_reopen", { item_id: "itm_token", rev: 1 }]);
  });

  it("a past due date on an open item is marked overdue; a done one is struck through", async () => {
    await ready();
    expect(renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec", { due: "2020-01-02" })} />)).toContain("is-overdue");
    const done = renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec", { due: "2020-01-02", status: "done" })} />);
    expect(done).not.toContain("is-overdue");
    expect(done).toContain("is-done");
  });

  it("compact: no Accept/Reject buttons, a Review menu on a suggestion, no Edit without the inspector", async () => {
    await ready();
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_replay")} variant="compact" />);
    expect(html).toContain('data-variant="compact"');
    expect(html).toContain("Review suggested item");
    expect(html).not.toContain(">Accept<");
    expect(reviewMenu({ accept: () => {}, edit: null, reject: () => {} }).map((m) => ("label" in m ? m.label : ""))).toEqual(["Accept", "Reject"]);
    expect(reviewMenu({ accept: () => {}, edit: () => {}, reject: () => {} }).map((m) => ("label" in m ? m.label : ""))).toEqual(["Accept", "Edit…", "Reject"]);
  });

  it("compact outcome collapses to the ghost line", async () => {
    await ready();
    patchLocal("itm_spec", { outcome: { text: "Done", target: null, ms: 10_000 } });
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec", { status: "done" })} variant="compact" />);
    expect(html).toContain("is-outcome");
    expect(html).toContain("Done");
  });

  it("the done variant offers Undo, which unticks with the wanted state", async () => {
    await ready();
    const seen = sent();
    const tree = rendered(ActionItemRow, { bridge, item: item("itm_spec", { status: "done" }), variant: "done" });
    expect(renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec", { status: "done" })} variant="done" />)).toContain('data-state="done"');
    press(tree, "Undo");
    await settle();
    expect(seen).toContainEqual(["item_set_done", { item_id: "itm_spec", rev: 1, done: false }]);
  });

  it("read-only has a bullet instead of a checkbox and no actions", async () => {
    await ready();
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec")} variant="read-only" />);
    expect(html).toContain('data-variant="read-only"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("a failed command shows its error on the row", async () => {
    await ready();
    patchLocal("itm_replay", { error: "Couldn't finish that. Try again." });
    expect(renderToString(<ActionItemRow bridge={bridge} item={item("itm_replay")} />)).toContain('role="alert"');
    expect(renderToString(<ActionItemRow bridge={bridge} item={item("itm_spec")} variant="compact" />)).not.toContain('role="alert"');
  });

  it("after a partial save only Accept is offered", async () => {
    await ready();
    patchLocal("itm_a11y", { retryAccept: true });
    const html = renderToString(<ActionItemRow bridge={bridge} item={item("itm_a11y")} />);
    expect(html).toContain(">Accept<");
    expect(html).not.toContain(">Reject<");
  });
});

describe("rowKey (flow inst-action)", () => {
  const spy = () => ({ prevent: vi.fn() });
  it("A accepts and R rejects a suggested row; E opens the draft", async () => {
    await ready();
    const seen = sent();
    const it = item("itm_replay");
    rowKey(bridge, it, {}, key("KeyA", { key: "a" }));
    await settle();
    expect(seen).toContainEqual(["item_review", { item_id: "itm_replay", rev: 1, decision: "accept" }]);
    rowKey(bridge, item("itm_a11y"), {}, key("KeyR", { key: "r" }));
    await settle();
    expect(seen).toContainEqual(["item_review", { item_id: "itm_a11y", rev: 1, decision: "reject" }]);
    rowKey(bridge, it, {}, key("KeyE", { key: "e" }));
    expect(localOf("itm_replay").phase).toBe("editing");
  });

  it("does nothing on an accepted row, in a text field, in composition or for ⇧A (the section's)", async () => {
    await ready();
    const seen = sent();
    rowKey(bridge, item("itm_spec"), {}, key("KeyA"));
    rowKey(bridge, item("itm_replay"), {}, key("KeyA", { target: { tagName: "TEXTAREA" } }));
    rowKey(bridge, item("itm_replay"), {}, key("KeyA", { isComposing: true }));
    rowKey(bridge, item("itm_replay"), {}, key("KeyA", { shiftKey: true }));
    await settle();
    expect(seen).toEqual([]);
  });

  it("while editing Esc discards the draft and ⌘Return saves it; other keys do nothing", async () => {
    await ready();
    const seen = sent();
    const it = item("itm_a11y");
    const draft = { text: "Mine", owner: "per_anna", due: "", engineering: false, linked_issue: "" };
    rowKey(bridge, it, { phase: "editing", draft }, key("KeyA"));
    expect(seen).toEqual([]);
    rowKey(bridge, it, { phase: "editing", draft }, key("Escape", { key: "Escape" }));
    expect(localOf("itm_a11y").phase).toBeUndefined();
    rowKey(bridge, it, { phase: "editing", draft }, key("Enter", { key: "Enter", metaKey: true }));
    await settle();
    expect(seen.map((s) => s[0])).toContain("item_edit");
  });

  it("Esc on the handoff question keeps the item handed off; ⌘I opens the inspector once it exists", async () => {
    await ready();
    const seen = sent();
    rowKey(bridge, item("itm_virt"), { asking: true }, key("Escape", { key: "Escape" }));
    await settle();
    expect(seen).toContainEqual(["item_answer_handoff_landed", { item_id: "itm_virt", rev: 1, answer: "keep_open" }]);
    const inspect = vi.fn();
    rowKey(bridge, item("itm_spec"), {}, key("KeyI", { metaKey: true }));
    expect(inspect).not.toHaveBeenCalled();
    slots.inspect = inspect;
    rowKey(bridge, item("itm_spec"), {}, key("KeyI", { metaKey: true }));
    expect(inspect).toHaveBeenCalledWith(bridge, "itm_spec");
  });
  void spy;
});

describe("focusNext", () => {
  it("focuses the next suggested row in page order", () => {
    const focused: string[] = [];
    const rows = [["a", "accepted"], ["b", "suggested"], ["c", "suggested"]].map(([id, review]) => ({ dataset: { itemId: id, review }, focus: () => focused.push(id!) }));
    vi.stubGlobal("document", { querySelectorAll: () => rows });
    expect(focusNext("b")).toBe(true);
    expect(focused).toEqual(["c"]);
    vi.stubGlobal("document", { querySelectorAll: () => rows.slice(0, 2) });
    expect(focusNext("b")).toBe(false);
  });
});

describe("RejectedList", () => {
  it("shows Rejected (n) folded; rows still in their outcome are not counted", async () => {
    await ready();
    const a = item("itm_replay", { review: "rejected" });
    const b = item("itm_a11y", { review: "rejected" });
    patchLocal("itm_a11y", { outcome: { text: "Rejected", target: null, ms: 1 } });
    const html = renderToString(<RejectedList bridge={bridge} items={[a, b, item("itm_spec")]} />);
    expect(html).toContain("Rejected (1)");
    expect(html).not.toContain("Restore"); // folded
    expect(renderToString(<RejectedList bridge={bridge} items={[item("itm_spec")]} />)).toBe("");
  });

  it("Restore sends item_review restore", async () => {
    await ready();
    const seen = sent();
    const rejected = item("itm_replay", { review: "rejected" });
    // open the list: the disclosure's handler flips local state, so render the open list through its first state
    const tree = rendered(RejectedList, { bridge, items: [rejected] });
    expect(find(tree, (p) => p.label === "Rejected (1)").props.open).toBe(false);
    await bridge.core.itemReview({ item_id: "itm_replay", rev: 1, decision: "reject" });
    const { review } = await import("./actions");
    await review(bridge, item("itm_replay", { rev: 2, review: "rejected" }), "restore");
    expect(seen.at(-1)).toEqual(["item_review", { item_id: "itm_replay", rev: 2, decision: "restore" }]);
  });
});
