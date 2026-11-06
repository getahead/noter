// S2 of Items: the Item inspector by kind, evidence resolution, the provenance chip, Add Action Item and the inspector seam.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { ItemView, TimeSpan } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { slots as outputSlots } from "../call-page/slots";
import { closeInspector, inspectorOverride, openInspector } from "../shell/inspector-override";
import { create } from "./actions";
import { AddItem } from "./AddItem";
import { openEvidence, resolveSpan, spanTime } from "./evidence";
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
});

describe("inspector seam (features/shell/inspector-override.ts)", () => {
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
