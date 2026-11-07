// M3 retrieval and Ask stories against the real core (Backend Teamlead TL-44): each `describe`
// names its DESIGN.md sequence and asserts the core-visible steps — search sections and their
// explain metadata, filtered calls and their export, topic threads with rename, an undoable merge
// and Keep Separate, and Ask turns streamed on their Channel with validated citations. Steps that
// read the real core's database or depend on its retrieval are guarded by `s.target === "stdio"`;
// the commands run on the fake too. All twelve 2.22 commands succeed at least once here.
import { afterEach, describe, expect, it } from "vitest";

import type { AskMsg, AskScope, Core } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";
import { rows } from "./history-support";

let s: Scenario;
let main: Core;
afterEach(async () => {
  await s.dispose();
});

const open = () => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
};
const scope = (patch: Partial<AskScope> = {}): AskScope => ({ people: [], call_types: [], from: null, to: null, topic_id: null, call_id: null, include_documents: false, ...patch });
const search = async (query: string) => ok(await main.search({ query, filter: {}, limit: null }));
const calls = async (filter: object) => ok(await main.callsList({ filter, sort: "newest", page: {} })).rows.map((r) => r.id);

/** One Ask turn to its terminal message: the handle, every Channel message in order, the answer. */
async function ask(question: string, thread: string | null = null, sc: AskScope = scope()) {
  const got: AskMsg[] = [];
  const handle = ok(await main.askStart({ thread_id: thread, question, scope: sc }, (m: AskMsg) => got.push(m)));
  const terminal = await until(() => got.find((m) => m.event.type === "done" || m.event.type === "failed"), `the end of "${question}"`);
  const answer = terminal.event.type === "done" ? terminal.event.answer : null;
  return { handle, got, answer };
}

describe("cpt-noter-seq-library-search-calls", () => {
  it("happy path: a mixed Russian and English query finds the Russian span, with its call, provenance and explain", async () => {
    open();
    const r = await search("websocket уведомления");
    const span = r.calls.find((h) => h.snippet.includes("уведомления"));
    expect(span, JSON.stringify(r.calls.map((h) => h.snippet))).toBeTruthy();
    expect(span!.call?.id).toBe(LIVE_CALL);
    expect(span!.target.type).toBe("segment");
    expect(span!.provenance.type).toBe("past_call");
    expect(span!.strength).toBe("strong");
    expect(r.explain.keyword_hits).toBeGreaterThan(0);
    if (s.target === "stdio") expect(r.explain.normalized_query).toBe("websocket уведомления");
  });

  it("empty — nothing matches: every section is empty and the results are not weak-only", async () => {
    open();
    const r = await search("zzqx никогда");
    expect([r.calls, r.items, r.documents, r.topics]).toEqual([[], [], [], []]);
    expect(r.only_weak).toBe(false);
    expect(r.explain.keyword_hits).toBe(0);
  });

  it("other — the mode says whether meaning was used, and a topic name finds its topic", async () => {
    open();
    const r = await search("websocket");
    expect(["hybrid", "keyword_only"]).toContain(r.mode.type);
    if (r.mode.type === "keyword_only") expect(r.mode.rebuild_progress).toBeGreaterThanOrEqual(0);
    expect(r.topics.map((t) => t.id)).toContain("top_ws");
    expect(r.only_weak).toBe(r.calls.length + r.items.length > 0 && [...r.calls, ...r.items].every((h) => h.strength === "weak"));
  });
});

describe("cpt-noter-seq-library-filter-calls", () => {
  it("happy path: people and open items narrow the calls, and the export writes the selection", async () => {
    open();
    const all = await calls({});
    const theirs = await calls({ people: ["per_dmitri"] });
    expect(theirs).toEqual(expect.arrayContaining([LIVE_CALL, PAST_CALL]));
    // The live call still has open items; the past call's only item is closed by evidence.
    const narrowed = await calls({ people: ["per_dmitri"], has_open_items: true });
    expect(narrowed).toContain(LIVE_CALL);
    expect(narrowed.length).toBeLessThanOrEqual(all.length);
    if (s.target === "stdio") expect(narrowed).toEqual([LIVE_CALL]);
    // The selection: Dmitri's finished call (the live one has no outputs to export yet).
    const exported = ok(await main.callsExport({ call_ids: [PAST_CALL], include: { summary_and_items: true, transcript: false, audio: false } }));
    expect(exported.files).toBeGreaterThan(0);
  });

  it("empty — a type no call has leaves no row, and clearing the filters restores them", async () => {
    open();
    const all = await calls({});
    expect(await calls({ people: ["per_dmitri"], has_open_items: true, call_types: ["incident"] })).toEqual([]);
    expect(await calls({})).toEqual(all);
  });

  it("other — a tag combines with people", async () => {
    open();
    expect(await calls({ tags: ["backend"] })).toContain(PAST_CALL);
    expect(await calls({ tags: ["backend"], people: ["per_dmitri"] })).toContain(PAST_CALL);
  });
});

describe("cpt-noter-seq-library-follow-topic", () => {
  it("happy path: a topic's thread groups its items by call, each opening its call", async () => {
    open();
    const drawer = ok(await main.topicsList({})).topics.find((t) => t.id === "top_drawer")!;
    expect(drawer.name).toBe("Drawer redesign");
    const thread = ok(await main.topicGet({ topic_id: "top_drawer" }));
    expect(thread.groups.length).toBeGreaterThan(0);
    for (const g of thread.groups) {
      expect(g.items.every((i) => i.call.id === g.call.id && i.topic?.id === "top_drawer")).toBe(true);
      expect(ok(await main.callGet({ call_id: g.call.id })).call.id).toBe(g.call.id);
    }
    if (s.target === "stdio") {
      const starts = thread.groups.map((g) => g.call.started_at);
      expect(starts).toEqual([...starts].sort((a, b) => b - a));
      expect(drawer.calls).toBe(thread.groups.length);
    }
  });

  it("empty — a topic no call holds an item of has an empty thread", async () => {
    open();
    const ws = ok(await main.topicGet({ topic_id: "top_ws" }));
    expect(ws.topic.id).toBe("top_ws");
    if (s.target === "stdio") expect(ws.groups).toEqual([]);
    expect(refused(await main.topicGet({ topic_id: "top_none" })).code).toBe("not_found");
  });

  it("other — a rename propagates to the item chips, a stale rename is a conflict and changes nothing", async () => {
    open();
    const drawer = ok(await main.topicGet({ topic_id: "top_drawer" })).topic;
    const renamed = ok(await main.topicRename({ topic_id: "top_drawer", rev: drawer.rev, name: "Drawer 8.0" }));
    expect(renamed.topic.name).toBe("Drawer 8.0");
    const chips = ok(await main.topicGet({ topic_id: "top_drawer" })).groups.flatMap((g) => g.items.map((i) => i.topic?.name));
    expect(new Set(chips)).toEqual(new Set(["Drawer 8.0"]));
    const stale = refused(await main.topicRename({ topic_id: "top_drawer", rev: drawer.rev, name: "Again" }));
    expect(stale).toMatchObject({ code: "conflict", detail: { type: "conflict", current_rev: renamed.topic.rev } });
    expect(ok(await main.topicGet({ topic_id: "top_drawer" })).topic.name).toBe("Drawer 8.0");
  });

  it("other — a merge keeps the source's name as an alias, change_undo restores both, and Keep Separate is stored", async () => {
    open();
    expect(refused(await main.topicsMerge({ source: "top_ws", target: "top_ws" })).code).toBe("invalid_input");
    const merged = ok(await main.topicsMerge({ source: "top_ws", target: "top_drawer" }));
    expect(merged.topic.aliases).toContain("Websocket notifications");
    expect(ok(await main.topicsList({})).topics.map((t) => t.id)).not.toContain("top_ws");
    if (s.target === "stdio") {
      // One undo restores the source topic and the target's aliases.
      expect(ok(await main.changeUndo({ target: { type: "change", change_id: merged.change_id } })).undone).toBeGreaterThan(0);
      const after = ok(await main.topicsList({})).topics;
      expect(after.map((t) => t.id)).toContain("top_ws");
      expect(after.find((t) => t.id === "top_drawer")!.aliases).not.toContain("Websocket notifications");
    }
    ok(await main.topicsKeepSeparate({ a: "top_notif", b: "top_drawer" }));
    expect(refused(await main.topicsKeepSeparate({ a: "top_drawer", b: "top_drawer" })).code).toBe("invalid_input");
    // Stored as the canonical pair, so it outlives the process (the restart itself: noter-core tests/topics.rs).
    if (s.target === "stdio") expect(await rows(s, "SELECT kind, key FROM suppressions")).toEqual([{ kind: "topic_merge", key: "top_drawer|top_notif" }]);
  });
});

describe("cpt-noter-seq-ask-cited-answer", () => {
  it("happy path: the handle comes first, then started, deltas, citations and done; every citation opens its evidence", async () => {
    open();
    expect(ok(await main.askScopePresets({})).presets.length).toBeGreaterThan(0);
    const { handle, got, answer } = await ask("What did we agree about the websocket notifications?");
    expect(got[0].event.type).toBe("started");
    expect(answer?.found).toBe(true);
    expect(answer!.turn_id).toBe(handle.turn_id);
    expect(answer!.citations.length).toBeGreaterThan(0);
    expect(got.some((m) => m.event.type === "citation")).toBe(true);
    for (const c of answer!.citations) {
      if (c.provenance.type === "past_call") expect(ok(await main.callGet({ call_id: c.provenance.call.id })).call.id).toBe(c.provenance.call.id);
    }
  });

  it("empty — nothing permitted to cite answers not found, never from the model's knowledge", async () => {
    open();
    const { answer } = await ask("zzqx никогда OpenStack", null, scope({ call_id: PAST_CALL }));
    if (s.target === "stdio") {
      expect(answer?.found).toBe(false);
      expect(answer!.citations).toEqual([]);
    }
  });

  it("other — a stop ends the turn once; bad questions and scopes are refused before any stream", async () => {
    open();
    const { handle } = await ask("What is open on the drawer?");
    ok(await main.askStop({ turn_id: handle.turn_id }));
    expect(refused(await main.askStart({ thread_id: null, question: " ", scope: scope() }, () => {})).code).toBe("invalid_input");
    if (s.target === "stdio") expect(refused(await main.askStart({ thread_id: null, question: "Q", scope: scope({ call_id: "call_none" }) }, () => {})).code).toBe("not_found");
  });
});

describe("cpt-noter-seq-ask-follow-up-and-copy", () => {
  it("happy path: reopen a thread, append a follow-up, and its citations carry what Markdown copy needs", async () => {
    open();
    const first = await ask("What did we agree about the websocket notifications?");
    expect(ok(await main.askThreadsList({})).threads.map((t) => t.id)).toContain(first.handle.thread_id);
    const follow = await ask("Who owns the acceptance criteria for the reconnect?", first.handle.thread_id);
    expect(follow.handle.thread_id).toBe(first.handle.thread_id);
    const thread = ok(await main.askThreadGet({ thread_id: first.handle.thread_id }));
    expect(thread.turns.map((t) => t.question)).toEqual(expect.arrayContaining(["What did we agree about the websocket notifications?", "Who owns the acceptance criteria for the reconnect?"]));
    for (const c of thread.turns.flatMap((t) => t.citations)) {
      expect(c.quote.length).toBeGreaterThan(0);
      if (c.provenance.type === "past_call") expect([c.provenance.call.title.length > 0, c.provenance.call.started_at > 0]).toEqual([true, true]);
    }
  });

  it("empty — deleting the thread removes it; an unknown thread is not found", async () => {
    open();
    const { handle } = await ask("What is open on the drawer?");
    ok(await main.askThreadDelete({ thread_id: handle.thread_id }));
    expect(refused(await main.askThreadGet({ thread_id: handle.thread_id })).code).toBe("not_found");
  });

  it("other — deleting a cited call marks the old citation deleted", async () => {
    open();
    if (s.target !== "stdio") return; // the fake keeps its canned thread
    // The past call, not the one still recording (a call being recorded cannot be deleted).
    const { handle, answer } = await ask("Can we keep serving reads while it rebuilds?", null, scope({ call_id: PAST_CALL }));
    const cited = answer!.citations.find((c) => c.provenance.type === "past_call");
    expect(cited, JSON.stringify(answer)).toBeTruthy();
    const call = cited!.provenance.type === "past_call" ? cited!.provenance.call.id : "";
    ok(await main.callsDelete({ call_ids: [call] }));
    const thread = ok(await main.askThreadGet({ thread_id: handle.thread_id }));
    expect(thread.turns[0].citations.find((c) => c.n === cited!.n)!.deleted).toBe(true);
  });
});
