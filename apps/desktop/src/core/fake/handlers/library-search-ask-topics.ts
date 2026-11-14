import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function libraryHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Library, search, ask, topics ─────────────────────────────────────
  calls_list: (a, { world }) => {
    const f = a.filter;
    let rows = world.calls.filter(
      (c) =>
        (!f.tags?.length || f.tags.some((t) => c.tags.includes(t))) &&
        (!f.call_types?.length || f.call_types.includes(c.call_type)) &&
        (!f.people?.length || f.people.some((p) => c.participants.some((x) => x.id === p))) &&
        (f.has_open_items == null || f.has_open_items === c.open_items > 0),
    );
    rows = [...rows].sort((x, y) => (a.sort === "oldest" ? x.started_at - y.started_at : a.sort === "longest" ? y.duration_ms - x.duration_ms : a.sort === "title" ? x.title.localeCompare(y.title) : y.started_at - x.started_at));
    return shared.pageRows(a.page, rows);
  },
  call_get: (a, { world }) => {
    // The calls row is the live one (call_update writes it): the detail answers it, as the real core does.
    const d = world.call_details.find((x) => x.call.id === a.call_id);
    if (d) return { ...d, call: world.calls.find((x) => x.id === a.call_id) ?? d.call };
    const c = shared.call(world, a.call_id);
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    return { call: c, calendar_event: null, speakers: t?.speakers ?? [], marks: t?.marks ?? [], gaps: t?.gaps ?? [], mode_used: world.app.privacy.effective, audio_not_stored: false, first_recorded_call: false, folder: `/Users/you/Library/Application Support/Noter/audio/${a.call_id}` };
  },
  call_update: (a, { world, emit }) => {
    const c = shared.call(world, a.call_id);
    shared.checkRev(c.rev, a.rev);
    const before = c.title;
    if (a.title != null) {
      if (!a.title.trim()) throw coreError("invalid_input", "title", { type: "validation", field: "title", rule: "required" });
      c.title = a.title;
    }
    if (a.call_type != null) {
      if (!world.call_types.call_types.some((t) => t.id === a.call_type)) throw coreError("invalid_input", "call type", { type: "validation", field: "call_type", rule: "invalid_format" });
      c.call_type = a.call_type;
    }
    c.rev += 1;
    emit("entity:changed", { type: "call", call: c });
    return { call: c, change_id: shared.logChange(fake, world, { entity: { kind: "call", id: c.id, label: c.title }, field: "title", before, after: c.title, summary: "Changed call info" }) };
  },
  // @cpt-flow:cpt-noter-flow-core-items-today-tags:p1
  call_tags_set: (a, { world }) => {
    for (const t of a.add) if (t.length < 1 || t.length > 32) throw coreError("invalid_input", "tag length", { type: "validation", field: "add", rule: t.length ? "too_long" : "too_short" });
    const remove = new Set(a.remove.map((tag) => tag.trim().toLowerCase()));
    if (a.add.some((tag) => remove.has(tag.trim().toLowerCase()))) throw coreError("invalid_input", "tag in add and remove", { type: "validation", field: "add", rule: "duplicate" });
    const calls = a.call_ids.map((id) => shared.call(world, id));
    // One change row a call, under one batch when several change together (as the core logs it).
    const batch_id = calls.length > 1 ? newId("bat") : null;
    const [change_id] = calls.map((c) => {
      const before = JSON.stringify(c.tags);
      c.tags = [...new Set([...c.tags.filter((t) => !a.remove.includes(t)), ...a.add])];
      return shared.logChange(fake, world, { entity: { kind: "call", id: c.id, label: c.title }, field: "tags", before, after: JSON.stringify(c.tags), summary: "Changed tags", batch_id });
    });
    return { calls, change_id, batch_id };
  },
  tags_list: (_a, { world }) => {
    const counts = new Map<string, number>();
    world.calls.forEach((c) => c.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return { tags: [...counts].map(([tag, calls]) => ({ tag, calls })) };
  },
  calls_delete: (a, { world, emit }) => {
    const ids = new Set(a.call_ids.filter((id) => world.calls.some((c) => c.id === id)));
    if (world.app.capture.call_id && ids.has(world.app.capture.call_id) && shared.live(world.app.capture)) throw coreError("already_recording", "stop the call before deleting it");
    world.calls = world.calls.filter((c) => !ids.has(c.id));
    world.call_details = world.call_details.filter((d) => !ids.has(d.call.id));
    world.transcripts = world.transcripts.filter((t) => !ids.has(t.call_id));
    ids.forEach((id) => emit("entity:changed", { type: "removed", kind: "call", id }));
    // Irreversible and content-free, as the core logs it.
    ids.forEach((id) => shared.logChange(fake, world, { entity: { kind: "call", id, label: id }, summary: "Deleted a call", undoable: false }));
    return { deleted: ids.size };
  },
  call_types_list: (_a, { world }) => world.call_types,
  search: (a, { world }) => {
    const q = a.query.toLowerCase();
    const segs = world.transcripts.flatMap((t) => t.segments).filter((s) => s.text.toLowerCase().includes(q));
    const items = world.items.filter((i) => i.text.toLowerCase().includes(q));
    const callOf = (id: string) => shared.callRef(shared.call(world, id));
    return {
      query: a.query,
      mode: { type: "hybrid" },
      calls: segs.map((s) => ({
        target: { type: "segment", span: { call_id: s.call_id, channel: s.channel, t0_ms: s.t0_ms, t1_ms: s.t1_ms } },
        title: callOf(s.call_id).title,
        snippet: s.text,
        highlights: [],
        lang: s.lang,
        strength: "strong",
        call: callOf(s.call_id),
        provenance: { type: "past_call", call: callOf(s.call_id), span: { call_id: s.call_id, channel: s.channel, t0_ms: s.t0_ms, t1_ms: s.t1_ms } },
        cross_language: false,
      })),
      items: items.map((i) => ({ target: { type: "item", item_id: i.id }, title: i.text, snippet: i.text, highlights: [], lang: i.lang, strength: "strong", call: i.call, provenance: { type: "past_call", call: i.call, span: i.spans[0] }, cross_language: false })),
      documents: [],
      topics: world.topics.filter((t) => t.name.toLowerCase().includes(q)),
      only_weak: false,
      explain: { keyword_hits: segs.length + items.length, semantic_hits: 0, normalized_query: q, filters_applied: 0 },
    };
  },
  ask_scope_presets: (_a, { world }) => world.scope_presets,
  ask_start: (a, { world, fake, send }) => {
    if (!a.question.trim()) throw coreError("invalid_input", "question", { type: "validation", field: "question", rule: "required" });
    const sub = newId("sub");
    const turn = newId("turn");
    const thread = a.thread_id ?? newId("ask");
    fake.openChannel(sub, "ask_start", send as (m: unknown) => void);
    const cite = world.ask_threads[0]?.turns[0]?.citations[0];
    const words = "On 2 Oct you agreed with Dmitri S. that drawer events go through the notification service [1].".split(" ");
    const run: shared.AskRun = { subscription: sub, thread, question: a.question, scope: a.scope, text: "", citations: [], timers: [] };
    const runs = shared.askRuns.get(fake) ?? new Map<string, shared.AskRun>();
    runs.set(turn, run);
    shared.askRuns.set(fake, runs);
    const later = (ms: number, action: () => void) => {
      run.timers.push(fake.later(ms, action));
    };
    const save = (answer: Bindings.AskAnswer) => {
      const existing = world.ask_threads.find((t) => t.id === thread);
      if (existing) existing.turns.push(answer);
      else world.ask_threads.unshift({ id: thread, title: a.question, scope: a.scope, turns: [answer] });
    };
    later(200, () => fake.push(sub, { event: { type: "started", runtime: "claude_api_key", mode: world.app.privacy.effective } }));
    words.forEach((w, i) => later(400 + i * 60, () => {
      const text = (i ? " " : "") + w;
      run.text += text;
      fake.push(sub, { event: { type: "delta", text } });
    }));
    if (cite) later(400 + words.length * 60, () => {
      run.citations.push(cite);
      fake.push(sub, { event: { type: "citation", citation: cite } });
    });
    later(400 + words.length * 60 + 100, () => {
      const answer: Bindings.AskAnswer = { turn_id: turn, question: a.question, answer_md: run.text, citations: run.citations, found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, asked_at: shared.now() };
      save(answer);
      fake.push(sub, { event: { type: "done", answer } });
      fake.push(sub, { event: { type: "ended", reason: "call_stopped" } });
      fake.closeChannel(sub);
      runs.delete(turn);
    });
    return { thread_id: thread, turn_id: turn, subscription_id: sub };
  },
  ask_stop: (a, { fake }) => {
    const runs = shared.askRuns.get(fake);
    const run = runs?.get(a.turn_id);
    if (run) {
      run.timers.forEach((timer) => fake.cancelLater(timer));
      if (run.text) {
        const answer: Bindings.AskAnswer = { turn_id: a.turn_id, question: run.question, answer_md: run.text, citations: run.citations, found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, asked_at: shared.now() };
        const world = fake.world;
        const existing = world.ask_threads.find((t) => t.id === run.thread);
        if (existing) existing.turns.push(answer);
        else world.ask_threads.unshift({ id: run.thread, title: run.question, scope: run.scope, turns: [answer] });
      }
      fake.push(run.subscription, { event: { type: "failed", error: coreError("answer_stopped", `turn ${a.turn_id} stopped`) } });
      fake.push(run.subscription, { event: { type: "ended", reason: "unsubscribed" } });
      fake.closeChannel(run.subscription);
      runs?.delete(a.turn_id);
    }
    return shared.ack;
  },
  ask_threads_list: (_a, { world }) => ({ threads: world.ask_threads.map((t) => ({ id: t.id, title: t.title, turns: t.turns.length, updated_at: t.turns.at(-1)?.asked_at ?? world.now })) }),
  ask_thread_get: (a, { world }) => {
    const t = world.ask_threads.find((x) => x.id === a.thread_id);
    if (!t) throw coreError("not_found", `thread ${a.thread_id}`);
    return t;
  },
  ask_thread_delete: (a, { world }) => {
    const before = world.ask_threads.length;
    world.ask_threads = world.ask_threads.filter((x) => x.id !== a.thread_id);
    if (world.ask_threads.length === before) throw coreError("not_found", `thread ${a.thread_id}`);
    return shared.ack;
  },
  topics_list: (_a, { world }) => ({ topics: world.topics }),
  topic_get: (a, { world }) => {
    const t = shared.topic(world, a.topic_id);
    const items = world.items.filter((i) => i.topic?.id === t.id);
    const calls = [...new Map(items.map((i) => [i.call.id, i.call])).values()];
    return { topic: t, groups: calls.map((c) => ({ call: c, items: items.filter((i) => i.call.id === c.id) })) };
  },
  topic_rename: (a, { world, emit }) => {
    const t = shared.topic(world, a.topic_id);
    shared.checkRev(t.rev, a.rev);
    if (!a.name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "name", rule: "required" });
    const before = t.name;
    t.aliases = [...new Set([...t.aliases, before])];
    t.name = a.name;
    t.rev += 1;
    world.items.forEach((i) => i.topic?.id === t.id && (i.topic = { id: t.id, name: t.name }));
    emit("entity:changed", { type: "topic", topic: t });
    return { topic: t, change_id: shared.logChange(fake, world, { entity: { kind: "topic", id: t.id, label: t.name }, field: "name", before, after: t.name, summary: `Renamed topic to ${t.name}` }) };
  },
  topics_merge: (a, { world, emit }) => {
    if (a.source === a.target) throw coreError("invalid_input", "same topic", { type: "validation", field: "target", rule: "duplicate" });
    const src = shared.topic(world, a.source);
    const dst = shared.topic(world, a.target);
    dst.aliases = [...new Set([...dst.aliases, src.name, ...src.aliases])];
    dst.calls += src.calls;
    dst.decisions += src.decisions;
    dst.open_items += src.open_items;
    dst.merge_suggestion = null;
    dst.rev += 1;
    world.topics = world.topics.filter((t) => t !== src);
    world.topics.forEach((t) => t.merge_suggestion?.id === src.id && (t.merge_suggestion = null));
    world.items.forEach((i) => i.topic?.id === src.id && (i.topic = { id: dst.id, name: dst.name }));
    emit("entity:changed", { type: "removed", kind: "topic", id: src.id });
    emit("entity:changed", { type: "topic", topic: dst });
    return { topic: dst, change_id: shared.logChange(fake, world, { entity: { kind: "topic", id: dst.id, label: dst.name }, summary: `Merged ${src.name} into ${dst.name}` }) };
  },
  topics_keep_separate: (a, { world }) => {
    const x = shared.topic(world, a.a);
    const y = shared.topic(world, a.b);
    if (x === y) throw coreError("invalid_input", "same topic", { type: "validation", field: "b", rule: "out_of_range" });
    if (x.merge_suggestion?.id === y.id) x.merge_suggestion = null;
    if (y.merge_suggestion?.id === x.id) y.merge_suggestion = null;
    return shared.ack;
  },

  };
}
