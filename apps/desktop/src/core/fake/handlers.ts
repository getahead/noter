// Default handlers of the fake core. They implement the contract's behaviour
// rules (rev checks, wanted-state commands, snapshot then stream, undo tokens)
// over the fixture world, so screens can be built against realistic responses.
// Add a handler here when a screen needs one; stories override per test with
// `new FakeCore({ handlers: { … } })` or `failNext`.

import type {
  CallRow,
  CardView,
  ChangeId,
  ChangeRow,
  ItemView,
  Rev,
  SubscriptionId,
  TimestampMs,
} from "../bindings";
import { coreError, type Handlers, type World } from "./fake-core";

let counter = 0;
const newId = (prefix: string) => `${prefix}_fake_${++counter}`;
const now = (): TimestampMs => Date.now();

function findItem(world: World, id: string): ItemView {
  const item = world.items.find((i) => i.id === id);
  if (!item) throw coreError("not_found", `item ${id}`);
  return item;
}

function checkRev(current: Rev, sent: Rev): void {
  if (current !== sent) throw coreError("conflict", "rev is stale", { type: "conflict", current_rev: current });
}

function logChange(world: World, row: Omit<ChangeRow, "id" | "at" | "batch_id" | "batch_size" | "evidence" | "confidence" | "status" | "undoable">): ChangeId {
  const id = newId("chg");
  world.changes.unshift({ ...row, id, at: now(), batch_id: null, batch_size: 1, evidence: [], confidence: null, status: "applied", undoable: true });
  return id;
}

function bump(item: ItemView): ItemView {
  item.rev = item.rev + 1;
  return item;
}

function call(world: World, id: string): CallRow {
  const c = world.calls.find((x) => x.id === id);
  if (!c) throw coreError("not_found", `call ${id}`);
  return c;
}

const ack = {};

export const defaultHandlers: Handlers = {
  // ── App ──────────────────────────────────────────────────────────────
  app_snapshot: (_a, { world, window }) => ({ ...world.app, window }),
  stream_unsubscribe: () => ack,
  log_ui: () => ack,

  // ── Capture ──────────────────────────────────────────────────────────
  capture_start: (a, { world, emit }) => {
    const cap = world.app.capture;
    if (cap.phase === "recording" || cap.phase === "paused") throw coreError("already_recording");
    if (!world.app.setup.complete) throw coreError("setup_incomplete");
    if (world.app.environment.disk_free_mb < 500) throw coreError("disk_full", "under 500 MB", { type: "disk_space", free_mb: world.app.environment.disk_free_mb });
    const id = newId("call");
    world.app.capture = { ...cap, phase: "recording", call_id: id, title: "New call", started_at: now(), recorded_ms: 0, sensitive: a.sensitive, pause: null, notice: null, continue_until: null };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_stop: (a, { world, emit }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || (cap.phase !== "recording" && cap.phase !== "paused")) throw coreError("not_recording");
    world.app.capture = { ...cap, phase: "stopped", notice: null, continue_until: now() + 5 * 60_000 };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_set_paused: (a, { world, emit }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id) throw coreError("not_recording");
    world.app.capture = { ...cap, phase: a.paused ? "paused" : "recording", pause: a.paused ? { since: now(), remind_at: now() + 5 * 60_000 } : null };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_mark_moment: (a, { world }) => ({ id: newId("mrk"), call_id: a.call_id, at_ms: world.app.capture.recorded_ms, note: a.note }),
  capture_continue: (a, { world, emit }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.continue_until || cap.continue_until < now()) throw coreError("continue_window_closed");
    world.app.capture = { ...cap, phase: "recording", continue_until: null };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_answer_call_end: (a, { world, emit }) => {
    const cap = world.app.capture;
    if (!cap.notice || cap.notice.type !== "call_ended") throw coreError("notice_expired");
    world.app.capture = a.choice === "keep_recording" ? { ...cap, notice: null } : { ...cap, phase: "stopped", notice: null, continue_until: now() + 5 * 60_000 };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_set_sensitive: (a, { world, emit }) => {
    world.app.capture = { ...world.app.capture, sensitive: a.sensitive };
    emit("capture:state", world.app.capture);
    return world.app.capture;
  },
  capture_dismiss_detection: (_a, { world, emit }) => {
    world.app.detection = null;
    emit("capture:detected", { detection: null });
    return ack;
  },
  capture_ignore_app: (a, { world }) => {
    world.settings.general.ignored_apps.push({ bundle_id: a.bundle_id, app_name: a.app_name });
    return ack;
  },

  // ── Transcript ───────────────────────────────────────────────────────
  transcript_subscribe: (a, { world, fake, send }) => {
    const snap = world.transcripts.find((t) => t.call_id === a.call_id);
    if (!snap) throw coreError("not_found", `transcript ${a.call_id}`);
    if (!snap.live) return { ...snap, subscription_id: null };
    const sub: SubscriptionId = newId("sub");
    world.live_script.forEach((event, i) => {
      fake.later((i + 1) * world.script_interval_ms, () => send({ seq: fake.nextSeq(sub, snap.last_seq), event }));
    });
    return { ...snap, subscription_id: sub };
  },
  levels_subscribe: (_a, { fake, send }) => {
    const sub = newId("sub");
    let t = 0;
    const tick = () => {
      t += 100;
      send({ seq: fake.nextSeq(sub), at_ms: t, mic_db: -30 - Math.random() * 20, sys_db: -25 - Math.random() * 20 });
      if (t < 30_000) fake.later(100, tick);
    };
    fake.later(100, tick);
    return { subscription_id: sub };
  },
  transcript_span: (a, { world }) => {
    const t = world.transcripts.find((x) => x.call_id === a.span.call_id);
    const c = call(world, a.span.call_id);
    return {
      span: a.span,
      call: { id: c.id, title: c.title, started_at: c.started_at, call_type: c.call_type },
      segments: (t?.segments ?? []).filter((s) => s.t1_ms >= a.span.t0_ms && s.t0_ms <= a.span.t1_ms),
      audio_available: !c.audio_deleted,
      upgraded_by_archive: false,
    };
  },
  transcript_rename_speaker: (a, { world }) => {
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    const spk = t?.speakers.find((s) => s.id === a.speaker_id);
    if (!t || !spk) throw coreError("not_found");
    const person =
      a.person.type === "existing"
        ? world.people.find((p) => p.id === (a.person as { person_id: string }).person_id)
        : undefined;
    const name = person?.display_name ?? (a.person.type === "new" ? a.person.display_name : "Unknown");
    spk.label = { type: "person", person: { id: person?.id ?? newId("per"), display_name: name, short_name: name, initials: name.slice(0, 2).toUpperCase(), is_you: false } };
    spk.named_by = "you";
    const change_id = logChange(world, { actor: { type: "you" }, entity: { kind: "speaker", id: spk.id, label: name }, field: "person", before: null, after: name, summary: `Named a speaker as ${name}`, reason: null });
    return { speakers: [spk], change_id };
  },
  transcript_fix_term: (a, { world }) => {
    const seg = world.transcripts.flatMap((t) => t.segments).find((s) => s.id === a.segment_id);
    if (!seg) throw coreError("not_found");
    const original = seg.text.slice(a.range.start, a.range.end);
    seg.text = seg.text.slice(0, a.range.start) + a.replacement + seg.text.slice(a.range.end);
    seg.corrections.push({ range: { start: a.range.start, end: a.range.start + a.replacement.length }, original });
    const change_id = logChange(world, { actor: { type: "you" }, entity: { kind: "segment", id: seg.id, label: "Transcript line" }, field: "text", before: original, after: a.replacement, summary: `Fixed “${original}” to “${a.replacement}”`, reason: null });
    return { segment: seg, change_id, glossary_term_id: a.add_to_glossary ? newId("gls") : null, proposal_queued: a.add_to_glossary };
  },
  audio_play: (a, { world }) => {
    if (call(world, a.call_id).audio_deleted) throw coreError("audio_deleted");
    const cap = world.app.capture;
    if (cap.call_id === a.call_id && cap.phase === "recording") {
      if (!world.settings.audio.exclude_own_sounds) throw coreError("own_sounds_not_excluded");
      if (cap.output_route === "unknown") throw coreError("output_route_unknown");
      if (cap.output_route === "speakers") throw coreError("replay_needs_headphones");
    }
    return { playing: true, call_id: a.call_id, position_ms: a.from_ms, to_ms: a.to_ms, route: cap.output_route };
  },
  audio_stop: (_a, { world }) => ({ playing: false, call_id: null, position_ms: 0, to_ms: null, route: world.app.capture.output_route }),

  // ── Copilot ──────────────────────────────────────────────────────────
  cards_subscribe: (a, { world }) => ({
    subscription_id: newId("sub"),
    call_id: a.call_id,
    visible: world.cards.filter((c) => c.call_id === a.call_id && c.number !== null),
    earlier: world.cards.filter((c) => c.call_id === a.call_id && c.number === null),
    pinned: world.items.filter((i) => i.call.id === a.call_id && i.created_by === "pin"),
    status: world.copilot,
    last_seq: 0,
  }),
  card_pin: (a, { world }) => {
    const card = world.cards.find((c) => c.id === a.card_id);
    if (!card) throw coreError("card_gone");
    card.state = "pinned";
    const c = call(world, card.call_id);
    const item: ItemView = {
      ...world.items[0],
      id: newId("itm"),
      rev: 1,
      call: { id: c.id, title: c.title, started_at: c.started_at, call_type: c.call_type },
      kind: "action_item",
      text: card.title,
      created_by: "pin",
      review: "accepted",
      status: "open",
    };
    world.items.push(item);
    return { card, item, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "item", id: item.id, label: item.text }, field: null, before: null, after: null, summary: "Pinned a card", reason: null }) };
  },
  card_dismiss: (a, { world }) => {
    const card = world.cards.find((c) => c.id === a.card_id);
    if (!card) throw coreError("card_gone");
    card.state = "dismissed";
    card.number = null;
    return { card, item: null, change_id: null };
  },
  card_set_held: () => ack,
  card_shown: () => ack,
  card_rate: (a, { world }) => {
    const card = world.cards.find((c) => c.id === a.card_id);
    if (!card) throw coreError("card_gone");
    card.rating = a.rating;
    return { card, item: null, change_id: null };
  },
  copilot_catch_up: (a, { world, fake }) => {
    const card: CardView = { ...world.cards[0], id: newId("card"), call_id: a.call_id, kind: "catch_up", solicited: true, title: "Last 5 minutes: drawer scope kept at 480 pt; reconnect owner still open.", created_at: now() };
    fake.later(2000, () => world.cards.unshift(card));
    return ack;
  },
  copilot_mute: (a, { world, emit }) => {
    world.copilot.muted = a.scope.type === "off" ? null : { scope: a.scope, until: a.scope.type === "for_minutes" ? now() + a.scope.minutes * 60_000 : null };
    emit("copilot:status", world.copilot);
    return world.copilot;
  },

  // ── Items ────────────────────────────────────────────────────────────
  items_list: (a, { world }) => {
    const f = a.filter;
    const rows = world.items.filter(
      (i) =>
        (!f.call_id || i.call.id === f.call_id) &&
        (!f.kinds?.length || f.kinds.includes(i.kind)) &&
        (!f.statuses?.length || f.statuses.includes(i.status)) &&
        (!f.reviews?.length || f.reviews.includes(i.review)) &&
        (!f.person_id || i.owner?.id === f.person_id),
    );
    return { rows, next_cursor: null, total: rows.length };
  },
  item_get: (a, { world }) => {
    const item = findItem(world, a.item_id);
    return { item, evidence: item.closed_by ? [item.closed_by] : [], history: world.changes.filter((c) => c.entity.id === item.id) };
  },
  item_set_done: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    const before = item.status;
    item.status = a.done ? "done" : "open";
    item.done_at = a.done ? now() : null;
    if (item.review === "suggested" && a.done) item.review = "accepted";
    bump(item);
    emit("entity:changed", { type: "item", item });
    return { item, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "item", id: item.id, label: item.text }, field: "status", before, after: item.status, summary: a.done ? "Ticked an item" : "Unticked an item", reason: null }) };
  },
  item_review: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    const before = item.review;
    item.review = a.decision === "accept" ? "accepted" : a.decision === "reject" ? "rejected" : "suggested";
    bump(item);
    emit("entity:changed", { type: "item", item });
    return { item, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "item", id: item.id, label: item.text }, field: "review", before, after: item.review, summary: `Review: ${item.review}`, reason: null }) };
  },
  items_review_all: (a, { world }) => {
    const items = world.items.filter((i) => i.call.id === a.call_id && i.review === "suggested" && (!a.kinds.length || a.kinds.includes(i.kind)));
    items.forEach((i) => bump(Object.assign(i, { review: "accepted" as const })));
    return { items, batch_id: items.length ? newId("bat") : null, skipped: 0 };
  },
  item_edit: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    const before = item.text;
    if (a.patch.text != null) {
      if (!a.patch.text.trim()) throw coreError("invalid_input", "text required", { type: "validation", field: "text", rule: "required" });
      item.text = a.patch.text;
      item.edited = true;
    }
    if (a.patch.kind) item.kind = a.patch.kind;
    if (a.patch.is_engineering != null) item.is_engineering = a.patch.is_engineering;
    if (a.patch.due) item.due = a.patch.due.type === "set" ? a.patch.due.date : null;
    if (a.patch.linked_issue) item.linked_issue = a.patch.linked_issue.type === "set" ? a.patch.linked_issue.text : null;
    bump(item);
    emit("entity:changed", { type: "item", item });
    return { item, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "item", id: item.id, label: item.text }, field: "text", before, after: item.text, summary: "Edited an item", reason: null }) };
  },
  item_reopen: (a, { world }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    item.status = "open";
    item.closed_by = null;
    item.done_at = null;
    bump(item);
    return { item, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "item", id: item.id, label: item.text }, field: "status", before: "closed", after: "open", summary: "Reopened an item", reason: null }) };
  },

  // ── Today, outputs, handoff ──────────────────────────────────────────
  today_get: (_a, { world }) => world.today,
  outputs_get: (a, { world }) => {
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    if (out) return out;
    return { call_id: a.call_id, status: "not_started", sections: [], archive: "not_started", review_waiting: 0, sensitive: false, written_locally: false };
  },
  output_edit: (a, { world }) => {
    const section = world.outputs.flatMap((o) => o.sections).find((s) => s.summary_id === a.summary_id);
    if (!section) throw coreError("not_found");
    if (section.rev !== null) checkRev(section.rev, a.rev);
    const before = section.body_md;
    section.body_md = a.body_md;
    section.user_edited = true;
    section.rev = (section.rev ?? 0) + 1;
    return { section, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "summary", id: a.summary_id, label: "Summary" }, field: "body", before, after: a.body_md, summary: "Edited the summary", reason: null }) };
  },
  share_copy: (a, { world }) => {
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    if (!out || out.status === "writing" || out.status === "not_started") throw coreError("outputs_not_ready");
    const text = out.sections.map((s) => s.body_md ?? s.items.map((i) => `- ${i.text}`).join("\n")).join("\n\n");
    return { text, sections: out.sections.length, items: out.sections.reduce((n, s) => n + s.items.length, 0), unreviewed_in_scope: out.review_waiting, sensitive: out.sensitive };
  },
  handoff_get: (a, { world }) => {
    const item = findItem(world, a.item_id);
    if (!item.is_engineering) throw coreError("invalid_input", "not an engineering item");
    const repo = world.repos.mappings.find((m) => item.linked_issue?.startsWith(m.key)) ?? null;
    const own = item.owner?.is_you ?? false;
    return {
      item,
      state: { type: "ready" },
      rev: 1,
      prompt_md: `## Goal\n${item.text}\n\n## Context\nSaid in “${item.call.title}”.\n\nAsk before touching anything outside this scope.`,
      generated_md: null,
      edited: false,
      versions: [],
      target: repo?.default_tool ?? "claude_code",
      repo,
      unmapped_key: repo ? null : (item.linked_issue?.split("-")[0] ?? null),
      launch: { path: "claude_cli_link", needs_automation: false, automation_denied: false },
      default_action: own ? "open" : "copy_prompt",
      last: item.handoff,
    };
  },
  handoff_copy: (a, { world }) => {
    const item = findItem(world, a.item_id);
    if (item.review === "suggested") item.review = "accepted";
    return { chars: 420, item };
  },
  handoff_open: (a, { world }) => {
    const item = findItem(world, a.item_id);
    if (!world.repos.mappings.some((m) => item.linked_issue?.startsWith(m.key))) throw coreError("repo_not_mapped");
    item.status = "handed_off";
    item.review = "accepted";
    item.handoff = { target: "claude_code", at: now(), cwd: world.repos.mappings[0].local_path, awaiting: true };
    bump(item);
    return { path_used: "claude_cli_link", item, prompt_file: `handoffs/${item.id}.md` };
  },

  // ── Library, search, ask, topics ─────────────────────────────────────
  calls_list: (a, { world }) => {
    const f = a.filter;
    const rows = world.calls.filter((c) => (!f.tags?.length || f.tags.some((t) => c.tags.includes(t))) && (!f.call_types?.length || f.call_types.includes(c.call_type)));
    return { rows, next_cursor: null, total: rows.length };
  },
  call_get: (a, { world }) => {
    const d = world.call_details.find((x) => x.call.id === a.call_id);
    if (d) return d;
    const c = call(world, a.call_id);
    return { call: c, calendar_event: null, speakers: [], marks: [], gaps: [], mode_used: "cloud_redacted", audio_not_stored: false, first_recorded_call: false };
  },
  call_tags_set: (a, { world }) => {
    for (const t of a.add) if (t.length < 1 || t.length > 32) throw coreError("invalid_input", "tag length", { type: "validation", field: "add", rule: "too_long" });
    const calls = a.call_ids.map((id) => {
      const c = call(world, id);
      c.tags = [...new Set([...c.tags.filter((t) => !a.remove.includes(t)), ...a.add])];
      return c;
    });
    return { calls, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "call", id: a.call_ids[0], label: "Tags" }, field: "tags", before: null, after: a.add.join(", "), summary: "Changed tags", reason: null }) };
  },
  tags_list: (_a, { world }) => {
    const counts = new Map<string, number>();
    world.calls.forEach((c) => c.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return { tags: [...counts].map(([tag, calls]) => ({ tag, calls })) };
  },
  call_types_list: (_a, { world }) => world.call_types,
  search: (a, { world }) => {
    const q = a.query.toLowerCase();
    const segs = world.transcripts.flatMap((t) => t.segments).filter((s) => s.text.toLowerCase().includes(q));
    const items = world.items.filter((i) => i.text.toLowerCase().includes(q));
    const callOf = (id: string) => {
      const c = call(world, id);
      return { id: c.id, title: c.title, started_at: c.started_at, call_type: c.call_type };
    };
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
  ask_start: (a, { fake, send }) => {
    const sub = newId("sub");
    const turn = newId("turn");
    const thread = a.thread_id ?? newId("ask");
    const words = "On 2 Oct you agreed with Dmitri S. that drawer events go through the notification service [1].".split(" ");
    fake.later(200, () => send({ seq: fake.nextSeq(sub), event: { type: "started", runtime: "claude_api_key", mode: "cloud_redacted" } }));
    words.forEach((w, i) => fake.later(400 + i * 60, () => send({ seq: fake.nextSeq(sub), event: { type: "delta", text: (i ? " " : "") + w } })));
    fake.later(400 + words.length * 60 + 100, () =>
      send({
        seq: fake.nextSeq(sub),
        event: {
          type: "done",
          answer: { turn_id: turn, question: a.question, answer_md: words.join(" "), citations: [], found: true, runtime: "claude_api_key", answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, asked_at: now() },
        },
      }),
    );
    return { thread_id: thread, turn_id: turn, subscription_id: sub };
  },
  ask_stop: () => ack,
  ask_threads_list: () => ({ threads: [] }),
  topics_list: (_a, { world }) => ({ topics: world.topics }),
  topic_get: (a, { world }) => {
    const topic = world.topics.find((t) => t.id === a.topic_id);
    if (!topic) throw coreError("not_found");
    const items = world.items.filter((i) => i.topic?.id === topic.id);
    return { topic, groups: items.length ? [{ call: items[0].call, items }] : [] };
  },

  // ── History ──────────────────────────────────────────────────────────
  history_list: (a, { world }) => {
    const t = a.target;
    const rows = world.changes.filter((c) => t.type === "all" || (t.type === "item" && c.entity.id === t.item_id) || (t.type === "call" && c.entity.id === t.call_id) || (t.type === "person" && c.entity.id === t.person_id));
    return { rows, next_cursor: null, total: rows.length };
  },
  change_undo: (a, { world }) => {
    const target = a.target;
    const rows = world.changes.filter((c) => (target.type === "change" ? c.id === target.change_id : c.batch_id === target.batch_id));
    if (!rows.length) throw coreError("not_found");
    if (rows.some((r) => !r.undoable || r.status === "undone")) throw coreError("undo_expired");
    rows.forEach((r) => (r.status = "undone"));
    return { undone: rows.reduce((n, r) => n + r.batch_size, 0), skipped_edited_later: 0, redo: newId("redo"), redo_until: now() + 10_000 };
  },
  change_redo: () => ({ undone: 0, skipped_edited_later: 0, redo: null, redo_until: null }),
  proposals_list: (_a, { world }) => ({ rows: world.proposals, next_cursor: null, total: world.proposals.length }),
  proposal_decide: (a, { world, emit }) => {
    const p = world.proposals.find((x) => x.id === a.proposal_id);
    if (!p) throw coreError("not_found");
    world.proposals = world.proposals.filter((x) => x.id !== p.id);
    world.app.proposals.waiting = world.proposals.length;
    emit("proposals:counts", world.app.proposals);
    return { proposal: p, status: a.decision === "accept" ? "applied" : "rejected", applied: a.decision === "accept" ? p.count : 0, batch_id: p.batch_id };
  },
  activity_get: (a, { world }) => ({ day: a.day ?? "2026-10-16", needs_attention: [], proposals: world.proposals, groups: [{ run: null, changes: world.changes, total: world.changes.length }] }),

  // ── People ───────────────────────────────────────────────────────────
  people_list: (a, { world }) => ({
    people: world.people.filter((p) => !a.query || p.display_name.toLowerCase().includes(a.query.toLowerCase())),
    unnamed: [],
  }),
  person_get: (a, { world }) => {
    const person = world.people.find((p) => p.id === a.person_id);
    if (!person) throw coreError("not_found");
    return {
      person,
      calls: world.calls.filter((c) => c.participants.some((p) => p.id === person.id)),
      owns_open: world.items.filter((i) => i.owner?.id === person.id && i.status === "open"),
      you_owe: [],
      open_questions: [],
      topics: world.topics.slice(0, 2),
      talk_share: null,
    };
  },
  person_create: (a, { world }) => {
    if (!a.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    const person = { ...world.people[1], id: newId("per"), rev: 1, display_name: a.display_name, short_name: a.display_name, initials: a.display_name.slice(0, 2).toUpperCase(), email: a.email, role: a.role, org: a.org, aliases: [], voice_profile: false, open_items: 0, is_you: false };
    world.people.push(person);
    return { person, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "person", id: person.id, label: person.display_name }, field: null, before: null, after: null, summary: `Added ${person.display_name}`, reason: null }) };
  },

  // ── Agents ───────────────────────────────────────────────────────────
  agents_get: (_a, { world }) => world.agents,
  agent_update: (a, { world, emit }) => {
    const agent = world.agents.agents.find((x) => x.id === a.agent_id);
    if (!agent) throw coreError("not_found");
    checkRev(agent.rev, a.rev);
    if (a.patch.runtime) {
      const rt = world.agents.runtimes.find((r) => r.runtime === a.patch.runtime);
      if (!rt?.available) throw coreError("runtime_unavailable", "runtime", { type: "runtime", runtime: a.patch.runtime, reason: rt?.reason ?? "no_key", fix: null });
    }
    Object.assign(agent, Object.fromEntries(Object.entries(a.patch).filter(([, v]) => v != null)));
    agent.rev += 1;
    emit("entity:changed", { type: "agent", agent });
    return { agent, change_id: logChange(world, { actor: { type: "you" }, entity: { kind: "agent", id: agent.id, label: agent.name }, field: null, before: null, after: null, summary: `Changed ${agent.name}`, reason: null }) };
  },

  // ── Settings and credentials ─────────────────────────────────────────
  settings_get: (_a, { world }) => world.settings,
  settings_update: (a, { world, emit }) => {
    checkRev(world.settings.rev, a.rev);
    const sec = a.section;
    (world.settings as unknown as Record<string, unknown>)[sec.section] = sec.value;
    world.settings.rev += 1;
    emit("settings:changed", world.settings);
    return world.settings;
  },
  accounts_get: (_a, { world }) => world.app.accounts,
  api_key_set: (a, { world, emit }) => {
    const key = world.app.accounts.keys.find((k) => k.provider === a.provider);
    if (!key) throw coreError("not_found");
    if (a.key.trim().length < 8 || a.key.includes("bad")) {
      key.status = { type: "rejected", reason: "key_rejected" };
      emit("accounts:changed", world.app.accounts);
      throw coreError("key_rejected");
    }
    key.status = { type: "configured", verified_at: now() };
    emit("accounts:changed", world.app.accounts);
    return world.app.accounts;
  },
  account_signin_prepare: (a, { world }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    return { provider: a.provider, cli: acc.cli, existing: null, needs_personal_use_confirmation: a.provider === "claude" };
  },
  account_signin_start: (a, { world, fake, emit }) => {
    if (a.provider === "claude" && !a.personal_use_confirmed) throw coreError("personal_use_not_confirmed");
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc?.cli.installed) throw coreError("cli_missing");
    const id = newId("sis");
    const identity = { email: "you@example.com", plan: a.provider === "claude" ? "Max" : "Plus" };
    const steps = ["waiting_for_browser", "signed_in", "checking_plan", "sending_test_request", "done"] as const;
    steps.forEach((step, i) =>
      fake.later(800 * (i + 1), () => {
        emit("signin:progress", { session_id: id, provider: a.provider, step, identity: i ? identity : null, error: null });
        if (step === "done") {
          acc.status = { type: "signed_in", identity, since: now() };
          emit("accounts:changed", world.app.accounts);
        }
      }),
    );
    acc.status = { type: "signing_in", session_id: id };
    return { id, provider: a.provider, url: "https://example.com/device", code: "ABCD-EFGH", expires_at: now() + 5 * 60_000 };
  },
  sources_list: (_a, { world }) => world.sources,
  jobs_list: (_a, { world }) => world.jobs,
  job_run_now: (_a, { world }) => {
    if (world.app.capture.phase === "recording") throw coreError("job_blocked", "a call is live");
    return { job_run_id: newId("run") };
  },
  hotkeys_list: (_a, { world }) => world.hotkeys,
  hotkey_set: (a, { world }) => {
    if (a.shortcut && !/(Ctrl|Alt|Super|Shift)\+/.test(a.shortcut)) throw coreError("invalid_input", "no modifier", { type: "validation", field: "shortcut", rule: "no_modifier" });
    const b = world.hotkeys.bindings.find((x) => x.action === a.action);
    if (b) b.shortcut = a.shortcut;
    return world.hotkeys;
  },
  repos_list: (_a, { world }) => world.repos,
  glossary_list: (_a, { world }) => world.glossary,
  audit_list: (_a, { world }) => ({ rows: world.audit, next_cursor: null, total: world.audit.length }),

  // ── Performance ──────────────────────────────────────────────────────
  perf_overview: (_a, { world }) => world.performance,

  // ── First run ────────────────────────────────────────────────────────
  setup_status: (_a, { world }) => world.app.setup,
  permission_request: (a, { world }) => {
    const row = world.app.setup.permissions.find((p) => p.kind === a.kind);
    if (!row) throw coreError("not_found");
    row.state = "granted";
    return row;
  },
  self_test_run: (_a, { fake, send }) => {
    const sub = newId("sub");
    fake.later(300, () => send({ seq: fake.nextSeq(sub), event: { type: "stream_arrived", channel: "mic" } }));
    fake.later(600, () => send({ seq: fake.nextSeq(sub), event: { type: "stream_arrived", channel: "sys" } }));
    fake.later(1200, () => send({ seq: fake.nextSeq(sub), event: { type: "line", channel: "sys", text: "This is the Noter self-test." } }));
    fake.later(1500, () => send({ seq: fake.nextSeq(sub), event: { type: "passed" } }));
    return { subscription_id: sub };
  },

  // ── Windows ──────────────────────────────────────────────────────────
  window_show_call: () => ({ visible: true, key: false, layout: "dedicated", collapsed: false, display_id: "dsp_studio", chosen_display_missing: false, show_share_warning: false }),
  window_call_state: () => ({ visible: true, key: false, layout: "dedicated", collapsed: false, display_id: "dsp_studio", chosen_display_missing: false, show_share_warning: false }),
  window_set_collapsed: (a) => ({ visible: true, key: false, layout: "floating", collapsed: a.collapsed, display_id: "dsp_builtin", chosen_display_missing: false, show_share_warning: false }),
  app_set_hidden_for_presenting: (a, { world, emit }) => {
    world.app.hidden_for_presenting = a.hidden;
    emit("app:presenting", { hidden: a.hidden });
    return { hidden: a.hidden };
  },
  window_navigate: (a, { emit }) => {
    if (a.target) emit("nav:request", a.target);
    return ack;
  },
  window_announce: () => ack,
  open_external: () => ack,
};
