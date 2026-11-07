// The drawer as it draws each state (HD-R1 to HD-R7) and what its keys and buttons send.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { HandoffView, UiPrefs } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { holdOutputs, resetOutputsCache } from "../call-page/outputs-cache";
import { closeInspector, inspectorOverride } from "../shell/inspector-override";
import { handoffButtonId, slots } from "../items/slots";
import { HandoffDrawer, recordLine } from "./HandoffDrawer";
import { patchLocal, resetLocal } from "./local";
import { PromptEditor, versionEntries } from "./PromptEditor";
import { flushDraft } from "./actions";
import "./register";

const ID = "itm_replay";
let bridge: Bridge;
let fake: FakeCore;
beforeEach(() => (resetLocal(), resetOutputsCache()));
afterEach(() => bridge.close());

async function ready(patch: (v: HandoffView) => Partial<HandoffView> = () => ({})) {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  const view = (await fake.invoke("handoff_get", { item_id: ID })) as HandoffView;
  hold({ ...view, ...patch(view) });
}
const hold = (v: HandoffView) => bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, handoff: { ...s.entities.handoff, [ID]: v } } }));
const draw = () => renderToString(<HandoffDrawer bridge={bridge} itemId={ID} />);
const tree = () => rendered(HandoffDrawer, { bridge, itemId: ID });
const prefs = { time_format: "h23", time_zone: "UTC" } as unknown as UiPrefs;
const own = (v: HandoffView) => ({ item: { ...v.item, owner: { ...v.item.owner!, is_you: true }, review: "accepted" as const }, default_action: "open" as const });

describe("HandoffDrawer (cpt-noter-component-ui-handoff-drawer)", () => {
  it("keeps the draft's base revision when another prompt arrives before saving", async () => {
    await ready(own);
    const before = bridge.store.getState().entities.handoff[ID]!;
    const editor = find(tree(), (p) => p.itemId === ID && typeof p.onChange === "function");
    (editor.props.onChange as (text: string) => void)("My draft");
    hold({ ...before, rev: (before.rev ?? 0) + 1, prompt_md: "Someone else's edit" });
    const edit = vi.spyOn(bridge.core, "handoffEdit");
    await flushDraft(bridge, ID);
    expect(edit).toHaveBeenCalledWith({ item_id: ID, rev: before.rev ?? 0, prompt_md: "My draft" });
  });

  it("draws HD-R1 to HD-R7 for a ready prompt of the user's own item", async () => {
    await ready(own);
    const html = draw();
    expect(html).toContain('data-component="cpt-noter-component-ui-handoff-drawer"');
    expect(html).toContain('data-variant="claude-code"');
    for (const r of ["HD-R1", "HD-R2", "HD-R3", "HD-R4", "HD-R5", "HD-R7"]) expect(html).toContain(`data-region="${r}"`);
    for (const text of ["Handoff", "Target", "Repository", "Opens Claude Code in your usual terminal", "Open in Claude Code", "Copy Prompt", "Regenerate"]) expect(html).toContain(text);
    expect(html.indexOf("Copy Prompt")).toBeLessThan(html.indexOf("Open in Claude Code"));
    expect(html).not.toContain("Opening or copying accepts");
  });

  it("someone else's suggested item: Open first, Copy Prompt default, the accept line", async () => {
    await ready((v) => ({ default_action: "copy_prompt", item: { ...v.item, review: "suggested" } }));
    const html = draw();
    expect(html).toContain('data-variant="suggested-item"');
    expect(html.indexOf("Open in Claude Code")).toBeLessThan(html.indexOf("Copy Prompt"));
    expect(html).toContain("Opening or copying accepts this suggested item.");
  });

  it("no mapping names the key, disables Open with its reason and keeps Copy Prompt", async () => {
    await ready((v) => ({ ...own(v), repo: null, unmapped_key: "VSTOR", launch: { path: "none", needs_automation: false, automation_denied: false } }));
    const t = tree();
    expect(renderToString(t)).toContain("No repository mapped for VSTOR");
    expect(renderToString(t)).toContain("hd__warn-text"); // the separator travels with the link (D350-3)
    (find(t, (p) => p.label === "Add Mapping…").props.onAction as () => void)(); // no sheet host in this probe: a no-op, not a throw
    expect(find(t, (p) => p.label === "Open in Claude Code").props).toMatchObject({ disabled: true, help: "No repository mapped for VSTOR" });
    expect(find(t, (p) => p.label === "Copy Prompt").props.disabled).toBe(false);
  });

  it("the Open button is described by the launch line and carries the scheme as its help tag", async () => {
    await ready(own);
    const open = find(tree(), (p) => p.label === "Open in Claude Code").props;
    expect(open.help).toBe("Opens through claude-cli://open · no Automation prompt");
    expect(open.attrs).toEqual({ "aria-describedby": `hl-${ID}` });
  });

  it("writing shows the progress, Cancel and no launch line; a failure shows Try Again", async () => {
    await ready((v) => ({ state: { type: "generating" }, prompt_md: null, rev: null, generated_md: null, ...own(v) }));
    let html = draw();
    expect(html).toContain("Writing the handoff prompt…");
    expect(html).toContain("Cancel");
    expect(html).not.toContain('data-region="HD-R5"');
    patchLocal(ID, { genFailed: "runtime_unavailable" });
    html = draw();
    expect(html).toContain("Couldn&#x27;t write the prompt");
    expect(html).toContain("Try Again");
  });

  it("a load failure offers Try Again, but not for an item that is gone", async () => {
    await ready();
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, handoff: {} } }));
    patchLocal(ID, { loadFailed: "internal" });
    expect(draw()).toContain("Couldn&#x27;t load the handoff");
    patchLocal(ID, { loadFailed: "not_found" });
    const html = draw();
    expect(html).toContain("Item not found");
    expect(html).not.toContain("Try Again");
  });

  it("an edit shows Edited and Your Edit; a failed open names the tool and keeps Copy Prompt", async () => {
    await ready(own);
    patchLocal(ID, { draft: "changed" });
    expect(draw()).toContain("Edited");
    patchLocal(ID, { draft: undefined, openFailed: "automation_denied" });
    expect(draw()).toContain("Couldn&#x27;t open Claude Code · use Copy Prompt");
  });

  it("the sensitive warning and the Local model tag come from the call", async () => {
    await ready(own);
    const callId = fake.world.items.find((i) => i.id === ID)!.call.id;
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, call: { ...s.entities.call, [callId]: { ...fake.world.calls.find((c) => c.id === callId)!, privacy: "sensitive" } } } }));
    holdOutputs({ call_id: callId, status: "ready", sections: [], archive: "none", review_waiting: 0, sensitive: true, written_locally: true } as never);
    const html = draw();
    expect(html).toContain('data-variant="sensitive-call"');
    expect(html).toContain("This call is sensitive. The prompt reaches a cloud model when you press Return in the terminal.");
    expect(html).toContain("Local model");
  });

  it("Codex names itself on the button and the line", async () => {
    await ready((v) => ({ ...own(v), target: "codex", launch: { path: "codex_app", needs_automation: false, automation_denied: false } }));
    const html = draw();
    expect(html).toContain("Open in Codex");
    expect(html).toContain("Opens Codex in your usual terminal");
  });

  it("⌘Return runs the default button, Esc closes the drawer, neither during composition", async () => {
    await ready(own);
    fake.world.repos.mappings.splice(0, fake.world.repos.mappings.length, { id: "rep_1", key: "VSTOR", local_path: "/work/vhi", default_tool: "claude_code", path_exists: true });
    const seen: string[] = [];
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((c: string, a: unknown) => (seen.push(c), (invoke as (...x: unknown[]) => unknown)(c, a))) as typeof fake.invoke;
    const onKeyDown = tree().props.onKeyDown as (e: unknown) => void;
    const ev = (o: object) => ({ key: "Enter", metaKey: true, defaultPrevented: false, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {}, ...o });
    onKeyDown(ev({ nativeEvent: { isComposing: true } }));
    onKeyDown(ev({ defaultPrevented: true }));
    expect(seen).toEqual([]);
    onKeyDown(ev({}));
    await vi.waitFor(() => expect(seen).toContain("handoff_open"));
    vi.stubGlobal("document", { getElementById: () => null });
    slots.openHandoff!(bridge, ID);
    expect(inspectorOverride()?.width).toBe(400);
    onKeyDown(ev({ key: "Escape", metaKey: false }));
    expect(inspectorOverride()).toBeNull();
    vi.unstubAllGlobals();
  });

  it("opening fills the inspector override and closing returns focus to the row's Handoff button", () => {
    const focus = vi.fn();
    vi.stubGlobal("document", { getElementById: (id: string) => (id === handoffButtonId(ID) ? { focus } : null) });
    slots.openHandoff!(bridge, ID);
    expect(inspectorOverride()).toMatchObject({ width: 400, label: "handoff.title" });
    closeInspector();
    expect(focus).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("recordLine", () => {
  it("says where and when the item was handed off, or the terminal that just opened", async () => {
    await ready(own);
    const view = (await fake.invoke("handoff_get", { item_id: ID })) as HandoffView;
    const item = { ...view.item, handoff: { target: "codex" as const, at: Date.UTC(2026, 9, 16, 10, 58), cwd: "/work/vhi", awaiting: true } };
    expect(recordLine(item, view, {}, prefs)).toBe("Handed off to Codex · Oct 16 10:58 · /work/vhi");
    expect(recordLine(item, view, { opened: "iterm" }, prefs)).toBe("Opened in iTerm · item marked Handed off");
    expect(recordLine({ ...item, handoff: null }, { ...view, last: null }, {}, prefs)).toBeNull();
  });
});

describe("PromptEditor (cpt-noter-component-ui-prompt-editor)", () => {
  const props = { itemId: ID, value: "Do it", edited: false, generated: "Do it", versions: [], prefs, showDiff: false, onDiff() {}, onChange() {} };
  const v = (n: number, kind: "generated" | "user_edit") => ({ id: `v${n}`, n, kind, writer: null, created_at: Date.UTC(2026, 9, 16, 10, 50 + n) });

  it("lists the generated versions and Your Edit, checking the one in use", () => {
    expect(versionEntries([v(1, "generated")], false, prefs)).toEqual([{ label: "Generated v1 · 10:51", checked: true }]);
    expect(versionEntries([v(1, "generated")], true, prefs)).toEqual([{ label: "Generated v1 · 10:51", checked: false }, { label: "Your Edit", checked: true }]);
    expect(versionEntries([v(1, "generated"), v(2, "user_edit")], true, prefs).map((e) => e.checked)).toEqual([false, true]);
    expect(versionEntries([v(1, "generated"), v(2, "generated")], false, prefs).map((e) => e.checked)).toEqual([false, true]);
  });

  it("draws the caption, Edited, Diff and the text area; Diff mode shows Showing changes read-only", () => {
    let html = renderToString(<PromptEditor {...props} edited versions={[v(1, "generated")]} />);
    for (const text of ["handoffs/itm_replay.md", "Edited", ">Your Edit<", ">Diff<", "<textarea"]) expect(html).toContain(text);
    html = renderToString(<PromptEditor {...props} showDiff value="Do it better" />);
    expect(html).toContain("Showing changes");
    expect(html).toContain("Hide Diff");
    expect(html).not.toContain("<textarea");
  });

  it("names the current generated version in the closed menu", () => {
    expect(renderToString(<PromptEditor {...props} versions={[v(1, "generated"), v(2, "generated")]} />)).toContain(">v2<");
  });

  it("generating shows the skeleton and no Diff; no generated text, no Diff", () => {
    let html = renderToString(<PromptEditor {...props} generating />);
    expect(html).toContain("pc-prompt__skel");
    expect(html).not.toContain(">Diff<");
    html = renderToString(<PromptEditor {...props} generated={null} />);
    expect(html).not.toContain(">Diff<");
  });
});

describe("S2 prompt state corrections", () => {
  it("cancelled empty generation offers an explicit retry without claiming it is writing", async () => {
    await ready((v) => ({ ...v, state: { type: "not_generated" }, prompt_md: null, generated_md: null }));
    const html = draw();
    expect(html).not.toContain("Writing the handoff prompt");
    expect(html).toContain("Write Prompt");
  });

  it("uses the live accepted item when hiding the suggested-item notice", async () => {
    await ready((v) => ({ item: { ...v.item, review: "suggested" } }));
    const view = bridge.store.getState().entities.handoff[ID]!;
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: { ...s.entities.item, [ID]: { ...view.item, review: "accepted" } } } }));
    expect(draw()).not.toContain("Opening or copying accepts this suggested item.");
  });

  it("checks only the current edit when several saved edits exist", () => {
    const versions = [1, 2, 3].map((n) => ({ id: `v${n}`, n, kind: n === 1 ? "generated" as const : "user_edit" as const, writer: null, created_at: n }));
    expect(versionEntries(versions, true, prefs).map((e) => e.checked)).toEqual([false, false, true]);
  });
});
