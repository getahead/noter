import { describe, expect, it } from "vitest";

import type { AppSnapshot, CardView, EventPayloads, SegmentView, TranscriptSnapshot } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { applyEvent, applySnapshot, applyWhole, createWindowStore, initialState, reduceStream } from "./window-store";

const world = new FakeCore({ window: "main" }).world;
const snapshot = (): AppSnapshot => ({
  contract_version: "2.0",
  app_version: "0.2.0",
  window: "main",
  setup: world.app.setup,
  capture: world.app.capture,
  detection: world.app.detection,
  copilot: null,
  privacy: world.app.privacy,
  presenting: world.app.presenting,
  degraded: world.app.degraded,
  accounts: world.app.accounts,
  features: world.app.features,
  prefs: world.app.prefs,
  proposals: world.app.proposals,
  banners: world.app.banners,
  environment: world.app.environment,
});

const seg = (id: string, channel: "mic" | "sys", t0: number, text = id): SegmentView =>
  ({ id, call_id: "c1", channel, t0_ms: t0, t1_ms: t0 + 1000, text }) as SegmentView;
const transcript = (): TranscriptSnapshot =>
  ({ subscription_id: "s1", call_id: "c1", segments: [seg("a", "mic", 0)], hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: 0 }) as unknown as TranscriptSnapshot;

describe("window store", () => {
  it("starts EMPTY with nothing from the core", () => {
    const s = createWindowStore("settings").getState();
    expect(s.status).toBe("EMPTY");
    expect(s.label).toBe("settings");
    expect(s.whole).toEqual({});
  });

  it("applies the snapshot's versioned slices and its plain parts", () => {
    const s = applySnapshot(initialState("main"), snapshot());
    expect(s.whole.capture?.version).toBe(world.app.capture.version);
    expect(s.whole.banners).toEqual(world.app.banners);
    expect(s.whole.copilot).toBeUndefined(); // null copilot is skipped
    expect(s.app?.features).toEqual(world.app.features);
  });

  it("keeps the whole-state slice with the highest version and replaces it whole", () => {
    let s = applyWhole(initialState("main"), "degraded", { version: 5, states: [{ type: "offline" } as never] });
    const late = applyWhole(s, "degraded", { version: 4, states: [] });
    expect(late).toBe(s); // a late payload is dropped
    expect(applyWhole(s, "degraded", { version: 5, states: [] })).toBe(s); // equal version too
    s = applyWhole(s, "degraded", { version: 6, states: [] });
    expect(s.whole.degraded).toEqual({ version: 6, states: [] }); // replaced, never merged
  });

  it("routes every whole-state event to its slice by version", () => {
    const s = applyEvent(initialState("main"), { event: "app:presenting", payload: { version: 3, hidden: true } });
    expect(s.whole.presenting).toEqual({ version: 3, hidden: true });
    const t = applyEvent(s, { event: "window:call", payload: { version: 1 } as EventPayloads["window:call"] });
    expect(t.whole.callWindow?.version).toBe(1);
  });

  it("keys entities by identity and removes them", () => {
    const call = { id: "call_1", rev: 1, title: "A" };
    let s = applyEvent(initialState("main"), { event: "entity:changed", payload: { type: "call", call: call as never } });
    s = applyEvent(s, { event: "entity:changed", payload: { type: "call", call: { ...(call as object), title: "B" } as never } });
    expect(s.entities.call.call_1?.title).toBe("B");
    s = applyEvent(s, { event: "entity:changed", payload: { type: "handoff", handoff: { item: { id: "i1" } } as never } });
    expect(s.entities.handoff.i1).toBeDefined();
    s = applyEvent(s, { event: "entity:changed", payload: { type: "speakers", call_id: "c", speakers: [{ id: "sp1" } as never] } });
    expect(s.entities.speaker.sp1).toBeDefined();
    for (const [kind, key, payload] of [
      ["item", "item", { id: "it1" }],
      ["person", "person", { id: "p1" }],
      ["topic", "topic", { id: "t1" }],
      ["agent", "agent", { id: "a1" }],
      ["source", "source", { id: "so1" }],
    ] as const) {
      s = applyEvent(s, { event: "entity:changed", payload: { type: kind, [key]: payload } as never });
      expect(Object.keys(s.entities[kind])).toEqual([payload.id]);
    }
    s = applyEvent(s, { event: "entity:changed", payload: { type: "removed", kind: "call", id: "call_1" } });
    expect(s.entities.call.call_1).toBeUndefined();
    expect(applyEvent(s, { event: "entity:changed", payload: { type: "removed", kind: "glossary", id: "g" } })).toBe(s);
  });

  it("keeps outputs, jobs, sign-ins and the last navigation request", () => {
    let s = initialState("main");
    s = applyEvent(s, { event: "outputs:progress", payload: { call_id: "c1", status: "writing", section: "summary", state: { type: "writing" } } });
    s = applyEvent(s, { event: "jobs:progress", payload: { run: { id: "r1" } as never } });
    s = applyEvent(s, { event: "signin:progress", payload: { session_id: "x", provider: "claude" } as never });
    s = applyEvent(s, { event: "nav:request", payload: { type: "today" } });
    expect(s.outputs["c1/summary"]?.status).toBe("writing");
    expect(s.jobs.r1).toBeDefined();
    expect(s.signin.x).toBeDefined();
    expect(s.nav).toEqual({ type: "today" });
  });
});

describe("stream flush", () => {
  it("transcript: confirmed rows append, the hypothesis per channel is replaced, updates by id, gaps and marks at their time", () => {
    const out = reduceStream("transcript_subscribe", transcript(), [
      { seq: 1, event: { type: "hypothesis", segment: seg("h1", "mic", 1000, "hel") } },
      { seq: 2, event: { type: "hypothesis", segment: seg("h2", "mic", 1000, "hello") } },
      { seq: 3, event: { type: "hypothesis", segment: seg("h3", "sys", 1000, "hi") } },
      { seq: 4, event: { type: "confirmed", segment: seg("b", "mic", 1000, "hello") } },
      { seq: 5, event: { type: "segments_updated", segments: [seg("a", "mic", 0, "fixed")] } },
      { seq: 6, event: { type: "speakers_updated", speakers: [{ id: "sp1" } as never], relabelled_by_archive: false } },
      { seq: 7, event: { type: "mark", mark: { id: "m2", call_id: "c1", at_ms: 5000, note: null } } },
      { seq: 8, event: { type: "mark", mark: { id: "m1", call_id: "c1", at_ms: 2000, note: null } } },
      { seq: 9, event: { type: "gap", gap: { call_id: "c1", t0_ms: 3000, t1_ms: 4000, reason: "paused" } } },
      { seq: 10, event: { type: "ended", reason: "call_stopped" } },
    ]);
    expect(out.segments.map((s) => [s.id, s.text])).toEqual([["a", "fixed"], ["b", "hello"]]);
    expect(out.hypotheses.map((h) => h.id)).toEqual(["h3"]); // the confirmed mic row removed its hypothesis
    expect(out.speakers.map((s) => s.id)).toEqual(["sp1"]);
    expect(out.marks.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(out.gaps).toHaveLength(1);
  });

  it("levels: keeps only the newest message", () => {
    const out = reduceStream("levels_subscribe", { subscription_id: "s", levels: null }, [
      { seq: 1, at_ms: 0, mic_db: -40, sys_db: null },
      { seq: 2, at_ms: 100, mic_db: -30, sys_db: -20 },
    ]);
    expect(out.levels?.seq).toBe(2);
  });

  it("cards: applied as the core sent them", () => {
    const card = (id: string, state = "shown") => ({ id, state, merged_agents: [] }) as unknown as CardView;
    const start = { subscription_id: "s", call_id: "c1", visible: [card("x")], earlier: [], pinned: [], status: world.copilot, last_seq: 0, feedback: null };
    const out = reduceStream("cards_subscribe", start, [
      { seq: 1, event: { type: "added", card: card("y") } },
      { seq: 2, event: { type: "updated", card: { ...card("y"), title: "T" } } },
      { seq: 3, event: { type: "merged", card_id: "y", merged_agents: [{ id: "ag" } as never] } },
      { seq: 4, event: { type: "removed", card_id: "x", state: "dismissed" } },
      { seq: 5, event: { type: "key_feedback", key: 1, outcome: "pinned", card_id: "y" } },
      { seq: 6, event: { type: "expired", card_id: "y", reason: "timeout" } as never },
      { seq: 7, event: { type: "status", status: { ...world.copilot, listening: false } } },
      { seq: 8, event: { type: "dropped_late", agent: { id: "ag" } as never, trigger_at_ms: 0 } },
    ]);
    expect(out.visible).toEqual([]);
    expect(out.earlier.map((c) => [c.id, c.state])).toEqual([["y", "expired"], ["x", "dismissed"]]);
    expect(out.earlier[0]?.title).toBe("T");
    expect(out.earlier[0]?.merged_agents).toHaveLength(1);
    expect(out.feedback).toEqual({ key: 1, outcome: "pinned", card_id: "y" });
    expect(out.status.listening).toBe(false);
  });

  it("ask and self-test: messages kept in order as sent", () => {
    const out = reduceStream("self_test_run", { subscription_id: "s", messages: [] }, [
      { seq: 1, event: { type: "levels", mic_db: -20, sys_db: null } },
      { seq: 2, event: { type: "passed" } as never },
    ]);
    expect(out.messages.map((m) => m.seq)).toEqual([1, 2]);
    const ask = reduceStream("ask_start", { thread_id: "t", turn_id: "u", subscription_id: "s", messages: [] }, [
      { seq: 1, event: { type: "started", runtime: "local", mode: "local_only" } },
    ]);
    expect(ask.messages).toHaveLength(1);
  });
});
