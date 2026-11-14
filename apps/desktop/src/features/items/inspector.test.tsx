// S2 of Items: the Item inspector by kind, evidence resolution, the provenance chip, Add Action Item and the inspector seam.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { ItemView, TimeSpan } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { OutputItemRow } from "../call-page/OutputItemRow";
import { slots as outputSlots } from "../call-page/slots";
import { find, rendered } from "../../ui/testing";
import { closeInspector, inspectorOverride, openInspector } from "../shell/inspector-override";
import { addItem, applyPatch, create, loadDetail, saveFields } from "./actions";
import { AddItem } from "./AddItem";
import { evidenceNotes, openEvidence, resolveSpan, spanTime } from "./evidence";
import { ItemInspector } from "./ItemInspector";
import { ItemTail } from "./ItemTail";
import { resetLocal } from "./local";
import { ProvenanceChip } from "./ProvenanceChip";
import { slots } from "./slots";
import "./register";

let bridge: Bridge;
let fake: FakeCore;
beforeEach(() => resetLocal());
afterEach(() => {
  closeInspector();
  return bridge.close();
});
async function ready() {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
}
const item = (id: string, o: Partial<ItemView> = {}): ItemView => ({ ...fake.world.items.find((i) => i.id === id)!, ...o });
const store = (...items: ItemView[]) => bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: Object.fromEntries(items.map((i) => [i.id, i])) } }));
const settle = () => new Promise((r) => setTimeout(r));
const span = (): TimeSpan => item("itm_notif").spans[0]!;

describe("ItemInspector (cpt-noter-component-ui-item-inspector)", () => {
  it("an action item shows Owner, Due, Status, Linked issue, Engineering, Save and Evidence", async () => {
    await ready();
    store(item("itm_a11y"));
    const html = renderToString(<ItemInspector bridge={bridge} itemId="itm_a11y" />);
    expect(html).toContain('data-component="cpt-noter-component-ui-item-inspector"');
    for (const label of ["Details", "History", "Owner", "Due", "Status", "Linked issue", "Engineering", "Save", "Evidence", "Accept", "Reject"]) expect(html).toContain(label);
  });

  it("a decision omits Owner, Due, Status and Engineering and keeps Linked issue and Evidence", async () => {
    await ready();
    store(item("itm_notif"));
    const html = renderToString(<ItemInspector bridge={bridge} itemId="itm_notif" />);
    expect(html).toContain('data-kind="decision"');
    for (const label of ["Owner", "Due", "Status", "Engineering"]) expect(html).not.toContain(`>${label}<`);
    for (const label of ["Linked issue", "Evidence"]) expect(html).toContain(label);
  });

  it("draws nothing until the item is in the store", async () => {
    await ready();
    expect(renderToString(<ItemInspector bridge={bridge} itemId="itm_none" />)).toBe("");
  });

  it("Escape closes only the item inspector and consumes the key", async () => {
    await ready();
    store(item("itm_a11y"));
    slots.inspect!(bridge, "itm_a11y");
    let consumed = 0;
    const tree = rendered(ItemInspector, { bridge, itemId: "itm_a11y" });
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "Escape", defaultPrevented: false, preventDefault: () => consumed++, stopPropagation: () => consumed++ });
    expect(inspectorOverride()).toBeNull();
    expect(consumed).toBe(2);
  });
});

describe("inspector seam (features/shell/inspector-override.ts)", () => {
  it("route changes clear the inspector without restoring focus to the old page", async () => {
    await ready();
    let closed = 0;
    openInspector({ width: 320, label: "items.inspector", render: () => null, onClose: () => closed++ });
    closeInspector("route");
    expect(inspectorOverride()).toBeNull();
    expect(closed).toBe(0);
  });

  it("opening replaces the page inspector, closing runs onClose and clears it", () => {
    let closed = 0;
    expect(inspectorOverride()).toBeNull();
    openInspector({ width: 320, label: "items.inspector", render: () => null, onClose: () => closed++ });
    expect(inspectorOverride()?.width).toBe(320);
    closeInspector();
    expect(inspectorOverride()).toBeNull();
    expect(closed).toBe(1);
  });

  it("the row's seam opens a 320-wide Item inspector that returns focus to the row", async () => {
    await ready();
    slots.inspect!(bridge, "itm_a11y");
    expect(inspectorOverride()).toMatchObject({ width: 320, label: "items.inspector" });
  });
});

describe("evidence (cpt-noter-flow-ui-items-evidence)", () => {
  it("resolves a span to its current segments and opens the Transcript on it", async () => {
    await ready();
    const nav: unknown[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown) => (cmd === "window_navigate" && nav.push(args), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
    expect((await resolveSpan(bridge, span())).status).toBe("ok");
    expect((await openEvidence(bridge, span())).status).toBe("ok");
    expect(nav).toEqual([{ target: { type: "call_page", call_id: span().call_id, tab: "transcript", span: span() } }]);
  });

  it("a vanished source is gone (no dead link) and any other failure is retryable", async () => {
    await ready();
    const gone = { ...span(), call_id: "call_missing" };
    expect((await resolveSpan(bridge, gone)).status).toBe("gone");
    fake.invoke = (async () => {
      throw new Error("boom");
    }) as never;
    expect((await resolveSpan(bridge, span())).status).toBe("error");
  });

  it("formats the span's start as the chip's time", () => {
    expect(spanTime({ ...span(), t0_ms: 1_272_000 })).toBe("00:21:12");
  });

  it("the provenance chip shows its time and opens the source", async () => {
    await ready();
    const html = renderToString(<ProvenanceChip bridge={bridge} span={{ ...span(), t0_ms: 1_272_000 }} />);
    expect(html).toContain('data-component="cpt-noter-component-ui-provenance-chip"');
    expect(html).toContain("00:21:12");
    expect(html).toContain('data-variant="timestamp"');
    expect(renderToString(<ProvenanceChip bridge={bridge} span={span()} unverified />)).toContain('data-variant="unverified"');
  });
});

describe("rows of the Summary view", () => {
  it("the tail of a suggested decision has its time, Accept, Edit, Reject and (i)", async () => {
    await ready();
    store(item("itm_notif", { review: "suggested" }));
    expect(outputSlots.itemTail).toBe(ItemTail);
    const html = renderToString(<ItemTail bridge={bridge} item={item("itm_notif", { review: "suggested" })} />);
    for (const label of ["Accept", "Edit", "Reject", "Show in Item inspector", "np-prov"]) expect(html).toContain(label);
    // Share and the inspector button stay one unit, so a narrow row wraps them together and never leaves (i) alone
    const rowEnd = html.slice(html.indexOf('class="it-row__end"'));
    expect(rowEnd).toContain('aria-label="Share item"');
    expect(rowEnd).toContain('aria-label="Show in Item inspector"');
    expect(rowEnd.indexOf('aria-label="Share item"')).toBeLessThan(rowEnd.indexOf('aria-label="Show in Item inspector"'));
  });

  it("Add Action Item trims the text, sends no owner and refuses an empty one", async () => {
    await ready();
    const seen: unknown[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown) => (cmd === "item_create" && seen.push(args), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
    expect(await create(bridge, "call_live", "   ")).toBeNull();
    expect((await create(bridge, "call_live", " Send the spec "))?.status).toBe("ok");
    expect(seen).toEqual([{ call_id: "call_live", kind: "action_item", text: "Send the spec" }]);
    await settle();
    expect(outputSlots.addItem).toBe(AddItem);
    expect(renderToString(<AddItem bridge={bridge} callId="call_live" />)).toContain("Add Action Item");
  });
});

describe("inspector and add-item commands", () => {
  const log = () => {
    const seen: Array<[string, unknown]> = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
    return seen;
  };

  it("addItem refuses empty text, adds and re-reads the section, and shows a refusal", async () => {
    await ready();
    const seen = log();
    expect(await addItem(bridge, "call_live", "  ")).toBe("Enter some text for the item.");
    expect(await addItem(bridge, "call_live", "Send it")).toBeNull();
    expect(seen.map(([c]) => c)).toEqual(["item_create", "outputs_get"]);
    expect(await addItem(bridge, "call_missing", "x")).not.toBeNull();
  });

  it("loadDetail returns the evidence and puts the item in the store; a missing item is null", async () => {
    await ready();
    expect(Array.isArray(await loadDetail(bridge, "itm_a11y"))).toBe(true);
    expect(bridge.store.getState().entities.item.itm_a11y).toBeTruthy();
    expect(await loadDetail(bridge, "itm_none")).toBeNull();
  });

  it("saveFields sends only the changed fields, nothing when unchanged, and refuses empty text", async () => {
    await ready();
    const it = item("itm_a11y");
    store(it);
    const seen = log();
    const same = { text: it.text, due: it.due ?? "", linked_issue: it.linked_issue ?? "" };
    expect(await saveFields(bridge, it, same)).toBeNull();
    expect(await saveFields(bridge, it, { ...same, text: " " })).not.toBeNull();
    expect(seen).toEqual([]);
    expect(await saveFields(bridge, it, { ...same, due: "2026-10-17" })).toBeNull();
    expect(seen).toEqual([["item_edit", { item_id: "itm_a11y", rev: it.rev, patch: { due: { type: "set", date: "2026-10-17" } } }]]);
  });

  it("applyPatch names a conflict and reads the item again", async () => {
    await ready();
    const it = item("itm_a11y");
    const seen = log();
    expect(await applyPatch(bridge, { ...it, rev: it.rev + 5 }, { is_engineering: true })).toMatch(/^Item changed since you opened it/);
    expect(seen.map(([c]) => c)).toContain("item_get");
  });

  it("inspector edits keep the draft revision even when the store has a newer item", async () => {
    await ready();
    const current = item("itm_a11y");
    store(current);
    const seen = log();
    expect(await applyPatch(bridge, { ...current, rev: current.rev - 1 }, { text: "Stale draft" })).toMatch(/^Item changed since/);
    expect(seen).toContainEqual(["item_edit", { item_id: current.id, rev: current.rev - 1, patch: { text: "Stale draft" } }]);
  });

  it("the inspector's buttons review and edit the item", async () => {
    await ready();
    store(item("itm_a11y", { review: "suggested" }));
    const seen = log();
    const tree = rendered(ItemInspector, { bridge, itemId: "itm_a11y" });
    (find(tree, (p) => p.label === "Accept" && typeof p.onAction === "function").props.onAction as () => void)();
    (find(tree, (p) => p.label === "Reject" && typeof p.onAction === "function").props.onAction as () => void)();
    (find(tree, (p) => p.label === "Engineering" && typeof p.onAction === "function").props.onAction as (v: boolean) => void)(true);
    await settle();
    expect(seen.map(([c]) => c)).toEqual(expect.arrayContaining(["item_review", "item_edit"]));
  });

  it("a decision row hands its keys to the items seam", async () => {
    await ready();
    const keys: string[] = [];
    const was = outputSlots.itemKeys;
    outputSlots.itemKeys = (_b, i, e) => void keys.push(i.id + e.key);
    const tree = rendered(OutputItemRow, { bridge, item: item("itm_notif") });
    (tree.props.onKeyDown as (e: unknown) => void)({ key: "a" });
    outputSlots.itemKeys = was;
    expect(keys).toEqual(["itm_notifa"]);
  });
});

describe("evidence notes (inst-audio, inst-archive)", () => {
  it("names the deleted audio and the archive upgrade; keeps the quote usable", async () => {
    await ready();
    const r = await resolveSpan(bridge, span());
    if (r.status !== "ok") throw new Error("span");
    expect(evidenceNotes(r.preview)).toEqual({ audioGone: false, archiveChanged: false });
    expect(evidenceNotes({ ...r.preview, audio_available: false, upgraded_by_archive: true })).toEqual({ audioGone: true, archiveChanged: true });
  });
});

describe("evidence over the archive pass (inst-archive)", () => {
  it("resolves a transcript_upgraded span as upgraded and still opens the Transcript on it", async () => {
    await ready();
    const upgraded = { ...bridge, core: { ...bridge.core, transcriptSpan: async () => ({ status: "error", error: { code: "transcript_upgraded", message: "" } }) } } as unknown as Bridge;
    expect(await resolveSpan(upgraded, span())).toEqual({ status: "upgraded" });
    const navigated: unknown[] = [];
    const nav = {
      ...upgraded,
      act: async (_key: string, _cmd: string, run: () => unknown) => run(),
      core: { ...upgraded.core, windowNavigate: async (a: unknown) => (navigated.push(a), { status: "ok", data: null }) },
    } as unknown as Bridge;
    expect((await openEvidence(nav, span())).status).toBe("upgraded");
    expect(navigated).toEqual([expect.objectContaining({ target: expect.objectContaining({ type: "call_page", tab: "transcript" }) })]);
  });
});

describe("ProvenanceChip click (cpt-noter-component-ui-provenance-chip)", () => {
  it("resolves the span and opens the Transcript on it when the time is pressed", async () => {
    await ready();
    const seen: string[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown) => (seen.push(cmd), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
    const tree = rendered(ProvenanceChip, { bridge, span: span() });
    const press = find(tree, (p, type) => type === "button" && typeof p.onClick === "function").props.onClick as () => void;
    press();
    await settle();
    await settle();
    expect(seen).toEqual(expect.arrayContaining(["transcript_span", "window_navigate"]));
  });
});

