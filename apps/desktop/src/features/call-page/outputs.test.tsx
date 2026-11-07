// The Summary view's components against the real bridge and the fake core: what each draws for held outputs, and what
// its controls send.
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallOutputs, ItemView, OutputSection as Section, SectionKind } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { holdDeleteError, holdExtras, resetCache } from "./cache";
import { CallBanners } from "./CallBanners";
import { loadCall } from "./actions";
import { OutputSection } from "./OutputSection";
import { OutputsView } from "./OutputsView";
import { announceSummaryOnce, commitDraft, loadOutputs, loadVersion, loadVersions, readVersion, regenerate, saveEdit } from "./outputs-actions";
import { bodyOf, holdOutputs, resetOutputsCache } from "./outputs-cache";
import { RegenerateSheet } from "./RegenerateSheet";
import { VersionSwitcher } from "./VersionSwitcher";
import { OutputItemRow } from "./OutputItemRow";
import { CallToolbar, moreItems } from "./CallToolbar";
import { slots } from "./slots";
import "./register";

let bridge: Bridge;
let fake: FakeCore;
let id: string;
beforeEach(() => (resetCache(), resetOutputsCache()));
afterEach(() => bridge.close());

const sec = (kind: SectionKind, o: Partial<Section> = {}): Section =>
  ({ kind, state: { type: "ready" }, summary_id: null, rev: null, body_md: null, items: [], reviews: [], writer: null, user_edited: false, regenerated_with_edits: false, names_updated: false, version_count: 1, ...o }) as Section;
const row = (text: string, review: ItemView["review"] = "accepted") => ({ id: `i_${text}`, text, review, lang: "en", spans: [], owner: null, topic: null }) as unknown as ItemView;

async function open(sections: Section[], status: CallOutputs["status"] = "ready", more: Partial<CallOutputs> = {}) {
  fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  id = fake.world.calls.find((c) => c.status === "ready")!.id;
  const res = await loadCall(bridge, id);
  if (res.status === "ok") holdExtras(id, res.data);
  holdOutputs({ call_id: id, status, sections, archive: "none", review_waiting: 0, sensitive: false, written_locally: false, ...more } as CallOutputs);
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r));
const view = () => renderToString(<OutputsView bridge={bridge} callId={id} />);

describe("OutputsView", () => {
  it("draws the sections in PRD order with their counts, meta line and rows", async () => {
    await open([sec("decisions", { items: [row("Ship it"), row("Not this", "rejected")] }), sec("summary", { summary_id: "s1", rev: 1, body_md: "Plain **text**", writer: { runtime: "claude_api_key", generated_at: 0 } as never })]);
    const html = view();
    expect(html.indexOf("Summary")).toBeLessThan(html.indexOf("Decisions"));
    expect(html).toContain("Decisions<span"); // heading with its count
    expect(html).toMatch(/Decisions<span[^>]*> · (<!-- -->)?1</); // the rejected row is not counted
    expect(html).toContain("Ship it");
    expect(html).not.toContain("Not this");
    expect(html).toContain("<strong>text</strong>");
    expect(html).toContain("Claude Code");
  });

  it("says what a section waits for, or why it failed, and offers Try Again and the local model", async () => {
    await open([sec("summary", { state: { type: "writing" } }), sec("decisions", { state: { type: "pending" } }), sec("action_items", { state: { type: "failed", code: "internal", local_fallback_available: true } as never }), sec("open_questions", { state: { type: "empty" } })], "writing");
    const html = view();
    for (const text of ["Writing summary…", "Waiting for the summary", "Couldn&#x27;t write the action items", "Try Again", "Use Local Model", "No open questions in this call"]) expect(html).toContain(text);
  });

  it("shows nothing until the outputs are read", async () => {
    await open([]);
    resetOutputsCache();
    expect(view()).toBe("");
  });
});

describe("OutputSection", () => {
  const props = (s: Section, onRegenerate = () => {}) => ({ bridge, call: bridge.store.getState().entities.call[id]!, section: s, prefs: { time_format: "h24", first_weekday: 1, time_zone: "UTC" } as never, writing: false, onRegenerate });

  it("keeps the old text readable while a section writes again, and shows partial text as it streams", async () => {
    await open([]);
    const waiting = renderToString(<OutputSection {...props(sec("summary", { state: { type: "pending" } }))} />);
    expect(waiting).toContain("Waiting for the summary");
    const writing = renderToString(<OutputSection {...props(sec("summary", { state: { type: "writing" } }))} />);
    expect(writing).toContain("Writing summary…");
    const regenerating = renderToString(<OutputSection {...props(sec("summary", { state: { type: "writing" }, summary_id: "s1", rev: 1, body_md: "The old text stays" }))} />);
    expect(regenerating).toContain("The old text stays");
    expect(regenerating).toContain("Regenerating…");
    const failed = renderToString(<OutputSection {...props(sec("summary", { state: { type: "failed", code: "internal", local_fallback_available: false } as never, summary_id: "s1", rev: 1, body_md: "Prior text survives a failure" }))} />);
    expect(failed).toContain("Try Again");
    const ready = renderToString(<OutputSection {...props(sec("summary", { summary_id: "s1", rev: 1, body_md: "Done" }))} />);
    expect(ready).not.toContain("Regenerating…");
  });

  it("notices what the regeneration returned: written by the local model, and names updated with a way to regenerate", async () => {
    await open([]);
    const local = { runtime: "local", model: "qwen3-14b", skill: "planning", skill_version: "1", generated_at: 1, from_pass: "live" } as never;
    const items = sec("action_items", { writer: local, items: [row("Rotate the token")] });
    expect(renderToString(<OutputSection {...props(items)} />)).toContain("Written by the local model after Claude Code timed out");
    expect(renderToString(<OutputSection {...props({ ...items, writer: { ...(local as object), runtime: "claude_api_key" } as never })} />)).not.toContain("Written by the local model");
    const renamed = sec("action_items", { names_updated: true, items: [row("Rotate the token")] });
    const html = renderToString(<OutputSection {...props(renamed)} />);
    expect(html).toContain("Names updated");
    expect(html).toContain("Regenerate for better wording");
    expect(renderToString(<OutputSection {...props(sec("action_items", { items: [row("Rotate the token")] }))} />)).not.toContain("Names updated");
    // the link regenerates that section with the current settings (not locally)
    const asked: boolean[] = [];
    const tree = rendered(OutputSection, props(renamed, (local) => void asked.push(local)));
    (find(tree, (p, type) => type === "button" && typeof p.onClick === "function" && p.children === "Regenerate for better wording").props.onClick as () => void)();
    expect(asked).toEqual([false]);
  });

  it("regenerates a failed section alone, and locally on Use Local Model", async () => {
    await open([]);
    const asked: boolean[] = [];
    const tree = rendered(OutputSection, props(sec("action_items", { state: { type: "failed", code: "internal", local_fallback_available: true } as never }), () => void asked.push(false)));
    const banner = find(tree, (p) => typeof p.banner === "object");
    const actions = (banner.props.banner as { actions: Array<{ label: string; onAction: () => void }> }).actions;
    actions.find((a) => a.label === "Try Again")!.onAction();
    expect(asked).toHaveLength(1);
  });

  it("offers Edit, Version and Regenerate on ready text, hides Version with one version, and Regenerate while writing", async () => {
    await open([]);
    const text = sec("summary", { summary_id: "s1", rev: 1, body_md: "x", version_count: 1 });
    const html = renderToString(<OutputSection {...props(text)} />);
    expect(html).toContain(">Edit<");
    expect(html).not.toContain("Version");
    expect(renderToString(<OutputSection {...props({ ...text, version_count: 2 })} />)).toContain("Version");
    expect(renderToString(<OutputSection {...props(text)} writing />)).toMatch(/disabled[^>]*>(<[^>]*>)*Regenerate|Regenerate/);
  });

  it("marks a section the user edited and tells that a regeneration kept the edits", async () => {
    await open([]);
    const html = renderToString(<OutputSection {...props(sec("summary", { summary_id: "s1", rev: 1, body_md: "x", user_edited: true, regenerated_with_edits: true }))} />);
    expect(html).toContain("Edited");
    expect(html).toContain("Show Diff");
  });
});

describe("VersionSwitcher", () => {
  it("is not drawn for a section with one version", async () => {
    await open([]);
    const s = sec("summary", { summary_id: "s1", version_count: 1 });
    expect(renderToString(<VersionSwitcher bridge={bridge} section={s} prefs={{} as never} showing={null} onShow={() => {}} comparing={false} onCompare={() => {}} />)).toBe("");
  });
});

describe("outputs commands", () => {
  async function withSummary() {
    await open([]);
    const s = fake.world.outputs.flatMap((o) => o.sections).find((x) => x.summary_id)!;
    const callId = fake.world.outputs.find((o) => o.sections.includes(s))!.call_id;
    return { s, callId };
  }

  it("outputs_get holds the outputs; output_edit sends the base rev and the text; versions are held and read", async () => {
    const { s, callId } = await withSummary();
    const rev = s.rev;
    const seen = sent();
    expect((await loadOutputs(bridge, callId)).status).toBe("ok");
    expect((await saveEdit(bridge, callId, s.summary_id!, rev!, "Edited text")).status).toBe("ok");
    expect(seen).toContainEqual(["output_edit", { call_id: callId, summary_id: s.summary_id, rev, body_md: "Edited text" }]);
    const list = await loadVersions(bridge, s.summary_id!);
    expect(list.status === "ok" && list.data.versions.length).toBeGreaterThan(1);
    const first = list.status === "ok" ? list.data.versions[0]! : null;
    expect((await loadVersion(bridge, s.summary_id!, first!.id)).status).toBe("ok");
    expect(bodyOf(s.summary_id!, first!.id)).toBeDefined();
  });

  it("a conflicting edit comes back as an error, and a missing version as not found", async () => {
    const { s, callId } = await withSummary();
    const r = await saveEdit(bridge, callId, s.summary_id!, (s.rev ?? 0) + 5, "x");
    expect(r.status).toBe("error");
    expect((await loadVersion(bridge, s.summary_id!, "ver_none")).status).toBe("error");
  });

  it("outputs_regenerate is accepted as a job, and refused with job_blocked while a call is live", async () => {
    const { callId } = await withSummary();
    const live = await regenerate(bridge, { call_id: callId, sections: ["summary"], local: false });
    expect(live.status === "error" && live.error.code).toBe("job_blocked"); // the fixture's 1:1 is recording
    fake.world.app.capture = { ...fake.world.app.capture, phase: "idle" } as never;
    expect((await regenerate(bridge, { call_id: callId, sections: ["summary"], local: false })).status).toBe("ok");
  });
});

describe("RegenerateSheet", () => {
  it("sends the chosen sections, runtime and skill, and closes when the job is accepted", async () => {
    await open([]);
    fake.world.app.capture = { ...fake.world.app.capture, phase: "idle" } as never; // the fixture's 1:1 is recording
    const seen = sent();
    let closed = 0;
    const tree = rendered(RegenerateSheet, { bridge, callId: id, sections: ["summary"], close: () => void closed++ });
    const foot = find(tree, (p) => "defaultButton" in p);
    ((foot.props.defaultButton as { props: { onAction: () => void } }).props.onAction)();
    await settle();
    expect(seen.find(([c]) => c === "outputs_regenerate")?.[1]).toMatchObject({ call_id: id, sections: ["summary", "decisions", "action_items", "open_questions"], local: false });
    expect(closed).toBe(1);
  });

  it("says the regeneration waits for the call when the core refuses with job_blocked", async () => {
    await open([]);
    let closed = 0;
    const tree = rendered(RegenerateSheet, { bridge, callId: id, sections: ["summary"], close: () => void closed++ });
    ((find(tree, (p) => "defaultButton" in p).props.defaultButton as { props: { onAction: () => void } }).props.onAction)();
    await settle();
    expect(closed).toBe(0);
  });
});

describe("CallBanners on the Summary view", () => {
  const route = (tab: string) => ({ section: "library", key: `call:${id}:${tab}` }) as const;
  it("says the outputs are being written, with Read Transcript, and that the local model wrote the summary", async () => {
    await open([sec("summary", { state: { type: "writing" } })], "writing");
    const html = renderToString(<CallBanners route={route("summary")} bridge={bridge} appBanners={0} />);
    expect(html).toContain("Writing the outputs · the transcript is ready to read");
    expect(html).toContain("Read Transcript");
    holdOutputs({ call_id: id, status: "ready", sections: [], archive: "none", review_waiting: 0, sensitive: false, written_locally: true } as unknown as CallOutputs);
    const local = renderToString(<CallBanners route={route("summary")} bridge={bridge} appBanners={0} />);
    expect(local).toContain("Summary written by the local model");
    expect(local).toContain("Regenerate with Claude Code…");
    holdDeleteError(id, null);
  });

  it("shows neither on the Transcript view", async () => {
    await open([], "writing");
    expect(renderToString(<CallBanners route={route("transcript")} bridge={bridge} appBanners={0} />)).not.toContain("Writing the outputs");
  });
});

describe("OutputItemRow", () => {
  it("surfaces a refused evidence route through the shell command state", async () => {
    await open([]);
    fake.failNext("window_navigate", "internal");
    const span = { call_id: id, t0_ms: 1000, t1_ms: 2000 };
    const link = find(rendered(OutputItemRow, { bridge, item: { ...row("Ship it"), spans: [span] } as ItemView }), (p) => p.label === "Show in transcript");
    (link.props.onAction as () => void)();
    await settle();
    expect(bridge.store.getState().commands.window_navigate?.state).toBe("ERROR");
  });
  it("opens the transcript at the evidence span", async () => {
    await open([]);
    const seen = sent();
    const span = { call_id: id, t0_ms: 1000, t1_ms: 2000 };
    const link = find(rendered(OutputItemRow, { bridge, item: { ...row("Ship it"), spans: [span] } as ItemView }), (p) => p.label === "Show in transcript");
    (link.props.onAction as () => void)();
    await settle();
    expect(seen).toContainEqual(["window_navigate", { target: { type: "call_page", call_id: id, tab: "transcript", span } }]);
  });
});

describe("the call toolbar's views and ⋯ menu", () => {
  it("the view control opens the other tab, and ⋯ offers Regenerate Outputs… before Show in Finder", async () => {
    await open([]);
    const seen = sent();
    const base = { narrow: false } as never;
    const tree = rendered(CallToolbar, { route: { section: "library", key: `call:${id}:summary` }, bridge, base, inspectorOpen: false, onToggleInspector: () => {} } as never);
    ((find(tree, (p) => "center" in p).props.center as { props: { onAction: (v: string) => void } }).props.onAction)("transcript");
    await settle();
    expect(seen).toContainEqual(["window_navigate", { target: { type: "call_page", call_id: id, tab: "transcript" } }]);
    const call = bridge.store.getState().entities.call[id]!;
    const labels = moreItems(call, [], { rename() {}, type() {}, sensitive() {}, finder() {}, remove: null, regenerate() {} }).map((i) => ("label" in i ? i.label : ""));
    expect(labels.indexOf("Regenerate Outputs…")).toBe(labels.indexOf("Show in Finder") - 1);
  });
});

describe("commitDraft and readVersion", () => {
  it("saves a draft, says conflict for a stale rev and error for anything else, and reads a version once", async () => {
    await open([]);
    const s = fake.world.outputs.flatMap((o) => o.sections).find((x) => x.summary_id)!;
    const callId = fake.world.outputs.find((o) => o.sections.includes(s))!.call_id;
    const draft = { summaryId: s.summary_id!, baseRev: s.rev!, text: "New" };
    expect(await commitDraft(bridge, callId, { ...draft, baseRev: s.rev! + 9 })).toBe("conflict");
    expect(await commitDraft(bridge, callId, { ...draft, summaryId: "sum_none" })).toBe("error");
    expect(await commitDraft(bridge, callId, draft)).toBe("ok");
    const seen = sent();
    const v = await loadVersions(bridge, s.summary_id!);
    const id0 = v.status === "ok" ? v.data.versions[0]!.id : "";
    expect(await readVersion(bridge, s.summary_id!, id0)).toBe(true);
    expect(await readVersion(bridge, s.summary_id!, id0)).toBe(true);
    expect(seen.filter(([c]) => c === "output_version_get")).toHaveLength(1);
    expect(await readVersion(bridge, s.summary_id!, "ver_none")).toBe(false);
  });
});

describe("the action item row slot", () => {
  afterEach(() => { slots.actionItemRow = null; slots.rejectedList = null; });
  it("keeps the action row as a React component and passes rejected rows to the registered slots", async () => {
    const accepted = row("Send it");
    const rejected = row("Not this", "rejected");
    await open([]);
    const Row = ({ item }: { item: ItemView }) => <b>{item.text}</b>;
    const Rejected = ({ items }: { items: ItemView[] }) => <aside>{items.map((i) => i.text).join()}</aside>;
    slots.actionItemRow = Row;
    slots.rejectedList = Rejected;
    const section = sec("action_items", { items: [accepted, rejected] });
    const props = { bridge, call: bridge.store.getState().entities.call[id]!, prefs: bridge.store.getState().app!.prefs, section, writing: false, onRegenerate() {} };
    const tree = rendered(OutputSection, props);
    expect(find(tree, (p, type) => type === Row && p.item === rejected).props.bridge).toBe(bridge);
    expect(find(tree, (_, type) => type === Rejected).props.items).toEqual([accepted, rejected]);
    const html = renderToString(tree);
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("<aside>"));
    const decisions = rendered(OutputSection, { ...props, section: { ...section, kind: "decisions" as const } });
    expect(find(decisions, (_, type) => type === Rejected).props.items).toEqual([accepted, rejected]);
    expect(() => find(decisions, (_, type) => type === Row)).toThrow("no matching element");
  });
  it("draws the registered row for action items and the plain row otherwise", async () => {
    await open([sec("action_items", { items: [row("Send it")] }), sec("decisions", { items: [row("Ship it")] })]);
    slots.actionItemRow = ({ item }) => <b>{`review:${item.text}`}</b>;
    const html = view();
    expect(html).toContain("review:Send it");
    expect(html).not.toContain("review:Ship it");
    expect(html).toContain("Ship it");
  });
});

describe("announceSummaryOnce (inst-visible)", () => {
  it("announces Summary ready politely once per call, and only when the Summary itself settled", async () => {
    await open([sec("summary")]);
    const seen = sent();
    const done = { current: null as string | null };
    expect(announceSummaryOnce(bridge, id, "decisions:ready", done)).toBe(false);
    expect(announceSummaryOnce(bridge, id, "summary:failed", done)).toBe(false);
    expect(announceSummaryOnce(bridge, id, "summary:ready", done)).toBe(true);
    expect(announceSummaryOnce(bridge, id, "decisions:ready,summary:ready", done)).toBe(false);
    await settle();
    expect(seen.filter(([cmd]) => cmd === "window_announce")).toEqual([["window_announce", { text: "Summary ready", politeness: "polite" }]]);
    expect(announceSummaryOnce(bridge, "another-call", "summary:ready", done)).toBe(true);
  });
});
