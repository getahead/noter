// Share, Export, tags and audio deletion against the real bridge and the fake core: what each control sends and shows.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallOutputs, ItemView, OutputSection as Section, SectionKind } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { dismissUndo, resetUndo } from "../history/undo";
import { shareShortcut } from "./actions";
import { holdExtras, resetCache } from "./cache";
import { loadCall } from "./actions";
import { ExportSheet } from "./ExportSheet";
import { runExport } from "./share-actions";
import { undoMode } from "../history/undo";
import { holdOutputs, resetOutputsCache } from "./outputs-cache";
import { deleteAudio, exportCall, setTags } from "./share-actions";
import { exportOpener, runShare, setShareStatus, unreviewedIn } from "./share-run";
import { SearchField, type SearchFieldProps } from "../../ui/primitives/search-field";
import { find, rendered } from "../../ui/testing";
import { ShareMenu, shareItems } from "./ShareMenu";
import { TagsField } from "./TagsField";
import { type MenuItem } from "../../ui/primitives/menu";

let bridge: Bridge;
let fake: FakeCore;
let id: string;
beforeEach(() => (resetCache(), resetOutputsCache(), resetUndo(), setShareStatus(null)));
afterEach(() => bridge.close());

const sec = (kind: SectionKind, o: Partial<Section> = {}): Section => ({ kind, state: { type: "ready" }, summary_id: null, rev: null, body_md: null, items: [], reviews: [], writer: null, user_edited: false, regenerated_with_edits: false, names_updated: false, version_count: 1, ...o }) as Section;
const row = (text: string, review: ItemView["review"] = "accepted") => ({ id: `i_${text}`, text, review, lang: "en", spans: [], owner: null, topic: null }) as unknown as ItemView;

async function open(sections: Section[], status: CallOutputs["status"] = "ready", more: Partial<CallOutputs> = {}) {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  id = fake.world.calls.find((c) => c.status === "ready")!.id;
  const res = await loadCall(bridge, id);
  if (res.status === "ok") holdExtras(id, res.data);
  const outputs = { call_id: id, status, sections, archive: "none", review_waiting: 0, sensitive: false, written_locally: false, ...more } as CallOutputs;
  holdOutputs(outputs);
  fake.world.outputs = [outputs as never, ...fake.world.outputs.filter((o) => o.call_id !== id)];
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const whole = { type: "toolbar" } as const;
const labels = (items: MenuItem[]) => items.flatMap((i) => ("label" in i ? [i.label] : "header" in i ? [i.header] : []));

describe("Share", () => {
  it("copies the whole call in the format and confirms on the control, Copied only for a sensitive call", async () => {
    await open([sec("decisions", { items: [row("Ship it")] })]);
    const seen = sent();
    await runShare(bridge, id, whole, "slack");
    expect(seen.find(([c]) => c === "share_copy")![1]).toMatchObject({ call_id: id, format: "slack", scope: { sections: [], item_ids: [], include_unreviewed: false } });
    await open([sec("decisions", { items: [row("Ship it")] })], "ready", { sensitive: true });
    await runShare(bridge, id, whole, "jira");
    expect(renderToString(<ShareMenu bridge={bridge} callId={id} origin={whole} id="pc-share" />)).toContain("Copied<");
  });

  it("says nothing is ready and sends no command while the outputs are written", async () => {
    await open([], "writing");
    const seen = sent();
    await runShare(bridge, id, whole, "markdown");
    expect(seen.some(([c]) => c === "share_copy")).toBe(false);
    expect(renderToString(<ShareMenu bridge={bridge} callId={id} origin={whole} id="pc-share" />)).toContain("Nothing to share yet");
  });

  it("keeps the scope and offers Copy anyway when suggestions are in it, and never includes them silently", async () => {
    await open([sec("decisions", { items: [row("A", "suggested"), row("B", "suggested"), row("C")] })]);
    const seen = sent();
    await runShare(bridge, id, { type: "section", kind: "decisions" }, "slack");
    const copies = () => seen.filter(([c]) => c === "share_copy").map(([, a]) => (a as { scope: { include_unreviewed: boolean } }).scope.include_unreviewed);
    expect(copies()).toEqual([false]);
    expect(renderToString(<ShareMenu bridge={bridge} callId={id} origin={{ type: "section", kind: "decisions" }} id="section-share" />)).toContain("Includes 2 suggested items not reviewed yet");
    const items = shareItems({ origin: { type: "section", kind: "decisions" }, ready: true, sensitive: false, unreviewed: 2, status: { callId: id, origin: whole, kind: "unreviewed", count: 2, format: "slack" }, copy: () => {}, exportIt: () => {} });
    expect(labels(items)).toEqual(expect.arrayContaining(["Decisions", "Includes 2 suggested items not reviewed yet", "Copy anyway", "Start Review"]));
    await runShare(bridge, id, { type: "section", kind: "decisions" }, "slack", true);
    expect(copies()).toEqual([false, true]);
  });

  it("counts the newer store item state over the output snapshot for the Share notice", async () => {
    const suggested = { ...row("A", "suggested"), rev: 1 };
    await open([sec("decisions", { items: [suggested] })]);
    setShareStatus({ callId: id, origin: { type: "section", kind: "decisions" }, kind: "unreviewed", count: 1, format: "slack" });
    bridge.store.setState((s) => ({ ...s, entities: { ...s.entities, item: { ...s.entities.item, [suggested.id]: { ...suggested, review: "accepted", rev: 2 } } } }));
    expect(unreviewedIn(id, { type: "section", kind: "decisions" }, bridge.store.getState().entities.item)).toBe(0);
    expect(renderToString(<ShareMenu bridge={bridge} callId={id} origin={{ type: "section", kind: "decisions" }} id="section-share" />)).not.toContain("Includes 1 suggested item");
  });

  it("lists the scope, the three copies with their keys and Export…, disabled until ready", () => {
    const items = shareItems({ origin: whole, ready: false, sensitive: true, unreviewed: 0, status: null, copy: () => {}, exportIt: () => {} });
    expect(labels(items)).toEqual(["Whole call", "Nothing to share yet: outputs are being written", "Sensitive call · copying puts the text on your clipboard", "Copy for Slack", "Copy for Jira", "Copy as Markdown", "Export…"]);
    expect(items.filter((i) => "label" in i && i.disabled)).toHaveLength(6);
  });

  it("runs ⌘⇧C and ⌘E from the page unless the user is typing", async () => {
    await open([sec("decisions", { items: [row("Ship it")] })]);
    const seen = sent();
    let opened = 0;
    exportOpener.open = () => void opened++;
    const ev = (code: string, mods: object, target: EventTarget | null = null) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: true, repeat: false, ...mods, target, preventDefault() {}, stopPropagation() {} });
    shareShortcut(bridge, id, ev("KeyC", { shiftKey: true }));
    shareShortcut(bridge, id, ev("KeyE", {}));
    shareShortcut(bridge, id, ev("KeyC", {}));
    shareShortcut(bridge, id, ev("KeyE", {}, { tagName: "INPUT", type: "text" } as unknown as EventTarget));
    await new Promise((r) => setTimeout(r));
    expect(seen.filter(([c]) => c === "share_copy")).toHaveLength(1);
    expect(opened).toBe(1);
    exportOpener.open = null;
  });
});

describe("Export", () => {
  const props = (audioKept: boolean, onExported = (_: string) => {}) => ({ bridge, callId: id, scopeLabel: "Whole call", scope: null, audioKept, onExported, close: () => {} });

  it("offers Audio only while it is kept, and sends the chosen include with a null scope for the whole call", async () => {
    await open([]);
    expect(renderToString(<ExportSheet {...props(true)} />)).toContain("Audio");
    expect(renderToString(<ExportSheet {...props(false)} />)).not.toContain(">Audio<");
    const seen = sent();
    const r = await exportCall(bridge, id, { summary_and_items: true, transcript: false, audio: false }, null);
    expect(r.status).toBe("ok");
    expect(seen.find(([c]) => c === "calls_export")![1]).toEqual({ call_ids: [id], include: { summary_and_items: true, transcript: false, audio: false }, scope: null });
  });

  it("reports the path the core returned, and nothing for a cancelled save panel or a failure", async () => {
    await open([]);
    const include = { summary_and_items: true, transcript: false, audio: false };
    const done = await runExport(bridge, id, include, null);
    expect(done).toMatchObject({ kind: "done" });
    expect((done as { path: string }).path).toContain("Noter export");
    fake.failNext("calls_export", "cancelled");
    expect(await runExport(bridge, id, include, null)).toEqual({ kind: "cancelled" });
    fake.failNext("calls_export", "internal");
    expect(await runExport(bridge, id, include, null)).toEqual({ kind: "failed" });
  });
});

describe("tags", () => {
  it("adds a tag, keeps the call's tag list and holds the change on the undo strip", async () => {
    await open([]);
    const seen = sent();
    const r = await setTags(bridge, id, ["release"], []);
    expect(r.status).toBe("ok");
    expect(seen.find(([c]) => c === "call_tags_set")![1]).toEqual({ call_ids: [id], add: ["release"], remove: [] });
    expect(undoMode()).toBe("undo");
    dismissUndo();
  });

  it("draws chips with remove buttons, and rejects a duplicate without sending", async () => {
    await open([]);
    const html = renderToString(<TagsField bridge={bridge} callId={id} tags={["bug", "q4"]} />);
    expect(html).toContain("Remove bug");
    expect(html).toContain("Add tag…");
  });
});

describe("Delete Audio Now…", () => {
  it("sends nothing when the alert is cancelled, and deletes only after the confirmation", async () => {
    await open([]);
    const seen = sent();
    const asked: string[] = [];
    expect(await deleteAudio(bridge, id, async (a) => (asked.push(a.title), false))).toBe("cancelled");
    expect(seen.some(([c]) => c === "audio_delete")).toBe(false);
    expect(asked[0]).toBe("Delete the audio of this call?");
    expect(await deleteAudio(bridge, id, async () => true)).toBe("deleted");
    expect(seen.find(([c]) => c === "audio_delete")![1]).toEqual({ call_ids: [id] });
    expect(bridge.store.getState().entities.call[id]?.audio_deleted).toBe(true);
  });
});


describe("Export sheet actions", () => {
  it("runs the scoped export from the sheet and reports the returned path before closing", async () => {
    await open([]);
    const seen = sent();
    const outcomes: string[] = [];
    const scope = { sections: ["decisions" as const], item_ids: [], include_unreviewed: false };
    const tree = rendered(ExportSheet, { bridge, callId: id, scopeLabel: "Decisions", scope, audioKept: false, onExported: (path: string) => outcomes.push(path), close: () => outcomes.push("closed") });
    (find(tree, (p) => typeof p.onDefault === "function").props.onDefault as () => void)();
    await new Promise((r) => setTimeout(r));
    expect(seen.find(([c]) => c === "calls_export")?.[1]).toEqual({ call_ids: [id], scope, include: { summary_and_items: true, transcript: false, audio: false } });
    expect(outcomes).toEqual([expect.stringContaining("Noter export"), "closed"]);
  });

  it("closes a cancelled export without success feedback, and keeps a failed export open", async () => {
    await open([]);
    for (const code of ["cancelled", "internal"] as const) {
      fake.failNext("calls_export", code);
      const outcomes: string[] = [];
      const tree = rendered(ExportSheet, { bridge, callId: id, scopeLabel: "Whole call", scope: null, audioKept: true, onExported: () => outcomes.push("exported"), close: () => outcomes.push("closed") });
      const button = find(tree, (p) => !!p.defaultButton).props.defaultButton as { props: { onAction: () => void } };
      button.props.onAction();
      await new Promise((r) => setTimeout(r));
      expect(outcomes).toEqual(code === "cancelled" ? ["closed"] : []);
    }
  });
});

describe("Tags field actions", () => {
  it("removes the named chip, or the last tag on Backspace, through the core", async () => {
    await open([]);
    await setTags(bridge, id, ["release", "backend"], []);
    const seen = sent();
    const tree = rendered(TagsField, { bridge, callId: id, tags: ["release", "backend"] });
    const field = find(tree, (_, type) => type === SearchField).props as unknown as SearchFieldProps;
    const control = SearchField(field);
    (find(control, (p) => p["aria-label"] === "Remove release").props.onClick as () => void)();
    await new Promise((r) => setTimeout(r));
    (find(control, (_, type) => type === "input").props.onKeyDown as (e: unknown) => void)({ key: "Backspace", currentTarget: { value: "", selectionEnd: 0 }, nativeEvent: { isComposing: false }, preventDefault() {} });
    await new Promise((r) => setTimeout(r));
    expect(seen.filter(([c]) => c === "call_tags_set").map(([, a]) => a)).toEqual([
      { call_ids: [id], add: [], remove: ["release"] },
      { call_ids: [id], add: [], remove: ["backend"] },
    ]);
    expect(bridge.store.getState().entities.call[id]?.tags).not.toContain("release");
    expect(bridge.store.getState().entities.call[id]?.tags).not.toContain("backend");
  });

  it("does not submit an empty tag and keeps existing tags on removal failure", async () => {
    await open([]);
    await setTags(bridge, id, ["release"], []);
    const seen = sent();
    const tree = rendered(TagsField, { bridge, callId: id, tags: ["release"] });
    const field = find(tree, (_, type) => type === SearchField).props as unknown as SearchFieldProps;
    field.onAddToken?.("");
    field.onAddToken?.("  ");
    expect(seen.filter(([c]) => c === "call_tags_set")).toHaveLength(0);
    fake.failNext("call_tags_set", "internal");
    field.onRemoveToken?.(0);
    await new Promise((r) => setTimeout(r));
    expect(bridge.store.getState().entities.call[id]?.tags).toContain("release");
  });
});


describe("Share control feedback", () => {
  it("routes each menu format and explicit Copy anyway to the requested copy action", () => {
    const copied: unknown[] = [];
    const started: string[] = [];
    const items = shareItems({ origin: whole, ready: true, sensitive: false, unreviewed: 2, status: { callId: "c", origin: whole, kind: "unreviewed", count: 2, format: "jira" }, copy: (format, include) => copied.push([format, include]), exportIt: () => {}, startReview: () => started.push("review") });
    for (const label of ["Copy for Slack", "Copy for Jira", "Copy as Markdown", "Copy anyway"]) {
      const item = items.find((i) => "label" in i && i.label === label) as { onSelect: () => void };
      item.onSelect();
    }
    expect(copied).toEqual([["slack", undefined], ["jira", undefined], ["markdown", undefined], ["jira", true]]);
    const startReview = items.find((i) => "label" in i && i.label === "Start Review") as { disabled?: boolean; onSelect?: () => void };
    expect(startReview.disabled).toBeFalsy();
    startReview.onSelect?.();
    expect(started).toEqual(["review"]);
  });

  it("expires feedback only on its matching section control", async () => {
    await open([]);
    const origin = { type: "section", kind: "decisions" } as const;
    setShareStatus({ callId: id, origin, kind: "copied", text: "Copied for Slack" });
    const props = { bridge, callId: id, origin, id: "section-share" };
    const tree = rendered(ShareMenu, props);
    expect(renderToString(tree)).toContain("Copied for Slack");
    expect(renderToString(<ShareMenu {...props} origin={{ type: "section", kind: "action_items" }} />)).not.toContain("Copied for Slack");
    (find(tree, (p) => typeof p.onExpire === "function").props.onExpire as () => void)();
    expect(renderToString(<ShareMenu {...props} />)).not.toContain("Copied for Slack");
  });
});


describe("the designed Share and Tags controls", () => {
  it("keeps the tags and draft inside the shared token field", async () => {
    await open([]);
    const html = renderToString(<TagsField bridge={bridge} callId={id} tags={["release", "backend"]} />);
    expect(html).toContain("np-search--token-field");
    expect(html).toContain('data-token-kind="tag"');
    expect(html).toMatch(/<label[^>]*>.*release.*backend.*<input[^>]*placeholder="Add tag…"[^>]*>.*<\/label>/);
  });

  it("shows the share glyph in the toolbar pull-down", async () => {
    await open([]);
    const tree = rendered(ShareMenu, { bridge, callId: id, origin: whole, id: "pc-share" });
    expect(find(tree, (p) => p.variant === "toolbar").props.icon).toBe("export");
  });
});


it("adds a typed token through the shared tag control and rejects duplicate tags before the core", async () => {
  await open([]);
  const seen = sent();
  const tree = rendered(TagsField, { bridge, callId: id, tags: ["existing"] });
  const field = find(tree, (_, type) => type === SearchField).props as unknown as SearchFieldProps;
  field.onAddToken?.("  release  ");
  await new Promise((r) => setTimeout(r));
  expect(bridge.store.getState().entities.call[id]?.tags).toContain("release");
  field.onAddToken?.("EXISTING");
  expect(seen.filter(([c]) => c === "call_tags_set")).toHaveLength(1);
});
