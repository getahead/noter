// Default handlers of the fake core: one per command of the contract. They implement the
// contract's behaviour rules (rev checks, wanted-state commands, snapshot then stream, undo
// and redo by target, versions on whole-state events, the capture rules of the 17 Oct review)
// over the fixture world, so screens can be built against realistic responses. Stories
// override per test with `new FakeCore({ handlers: { … } })`, `failNext` or `setWorld`.

import type {
  AgentView,
  CallRef,
  CallRow,
  CaptureState,
  CardEvent,
  CardView,
  ChangeId,
  ChangeRow,
  CopilotStatus,
  HandoffView,
  ItemView,
  JobRow,
  OutputSection,
  PersonRow,
  Rev,
  SourceRow,
  TimestampMs,
  TopicRow,
} from "../bindings";
import { coreError, type FakeCore, type Handlers, type World } from "./fake-core";

let counter = 0;
const newId = (prefix: string) => `${prefix}_fake_${++counter}`;
const now = (): TimestampMs => Date.now();
const ack = {};
const MIN = 60_000;

// ── helpers ──────────────────────────────────────────────────────────────

function findItem(world: World, id: string): ItemView {
  const item = world.items.find((i) => i.id === id);
  if (!item) throw coreError("not_found", `item ${id}`);
  return item;
}

function checkRev(current: Rev, sent: Rev): void {
  if (current !== sent) throw coreError("conflict", "rev is stale", { type: "conflict", current_rev: current });
}

type ChangeInput = Pick<ChangeRow, "entity" | "summary"> & Partial<Pick<ChangeRow, "actor" | "field" | "before" | "after" | "reason">>;

function logChange(world: World, row: ChangeInput): ChangeId {
  const id = newId("chg");
  world.changes.unshift({
    actor: { type: "you" },
    field: null,
    before: null,
    after: null,
    reason: null,
    ...row,
    id,
    at: now(),
    batch_id: null,
    batch_size: 1,
    evidence: [],
    confidence: null,
    status: "applied",
    undoable: true,
    redoable: false,
  });
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

function callRef(c: CallRow): CallRef {
  return { id: c.id, title: c.title, started_at: c.started_at, call_type: c.call_type };
}

function itemChanged(world: World, item: ItemView, emit: (e: "entity:changed", p: { type: "item"; item: ItemView }) => void, summary: string, field: string | null, before: string | null) {
  bump(item);
  emit("entity:changed", { type: "item", item });
  return { item, change_id: logChange(world, { entity: { kind: "item", id: item.id, label: item.text }, field, before, after: field ? String((item as Record<string, unknown>)[field] ?? "") : null, summary }) };
}

/** A capture is live: recording, paused or still starting. */
function live(cap: CaptureState): boolean {
  return cap.phase === "recording" || cap.phase === "paused" || cap.phase === "starting" || cap.phase === "failed";
}

function requireLive(cap: CaptureState, callId: string): void {
  if (cap.call_id !== callId || !live(cap)) throw coreError("not_recording", `no capture running for ${callId}`);
}

function setCapture(fake: FakeCore, next: Partial<CaptureState>): CaptureState {
  fake.world.app.capture = { ...fake.world.app.capture, ...next };
  fake.publish("capture:state");
  return fake.world.app.capture;
}

function findCard(world: World, id: string): CardView {
  const card = world.cards.find((c) => c.id === id);
  if (!card) throw coreError("card_gone", `card ${id}`);
  return card;
}

/** Last card action, for `card_undo_last` (30-second window). */
let lastCardAction: { card_id: string; state: CardView["state"]; number: number | null; item_id: string | null; at: number } | null = null;

function cardAction(world: World, card: CardView, item: ItemView | null) {
  lastCardAction = { card_id: card.id, state: card.state, number: card.number, item_id: item?.id ?? null, at: now() };
  return card;
}

/** Push on the newest card stream, if a call surface subscribed. */
function pushCards(fake: FakeCore, body: { event: CardEvent }) {
  fake.push("cards_subscribe", body);
}

function handoffView(world: World, item: ItemView, state: HandoffView["state"] = { type: "ready" }): HandoffView {
  const repo = world.repos.mappings.find((m) => item.linked_issue?.startsWith(m.key)) ?? null;
  const own = item.owner?.is_you ?? false;
  const edited = handoffEdits.get(item.id);
  const generated = `## Goal\n${item.text}\n\n## Context\nSaid in “${item.call.title}”.\n\nAsk before touching anything outside this scope.`;
  return {
    item,
    state,
    rev: state.type === "ready" ? (handoffRevs.get(item.id) ?? 1) : null,
    prompt_md: state.type === "ready" ? (edited ?? generated) : null,
    generated_md: state.type === "ready" ? generated : null,
    edited: edited !== undefined,
    versions: [],
    target: handoffTargets.get(item.id) ?? repo?.default_tool ?? "claude_code",
    repo,
    unmapped_key: repo ? null : (item.linked_issue?.split("-")[0] ?? null),
    launch: { path: repo ? "claude_cli_link" : "none", needs_automation: false, automation_denied: false },
    default_action: own ? "open" : "copy_prompt",
    last: item.handoff,
  };
}
const handoffEdits = new Map<string, string>();
const handoffRevs = new Map<string, number>();
const handoffTargets = new Map<string, HandoffView["target"]>();
const handoffGenerating = new Set<string>();

function requireEngineering(item: ItemView): void {
  if (!item.is_engineering) throw coreError("invalid_input", "not an engineering item", { type: "validation", field: "item_id", rule: "invalid_format" });
}

function section(world: World, summaryId: string): OutputSection {
  const s = world.outputs.flatMap((o) => o.sections).find((x) => x.summary_id === summaryId);
  if (!s) throw coreError("not_found", `summary ${summaryId}`);
  return s;
}

function topic(world: World, id: string): TopicRow {
  const t = world.topics.find((x) => x.id === id);
  if (!t) throw coreError("not_found", `topic ${id}`);
  return t;
}

function person(world: World, id: string): PersonRow {
  const p = world.people.find((x) => x.id === id);
  if (!p) throw coreError("not_found", `person ${id}`);
  return p;
}

function agent(world: World, id: string): AgentView {
  const a = world.agents.agents.find((x) => x.id === id);
  if (!a) throw coreError("not_found", `agent ${id}`);
  return a;
}

function source(world: World, id: string): SourceRow {
  const s = world.sources.sources.find((x) => x.id === id);
  if (!s) throw coreError("not_found", `source ${id}`);
  return s;
}

function job(world: World, id: string): JobRow {
  const j = world.jobs.jobs.find((x) => x.id === id);
  if (!j) throw coreError("not_found", `job ${id}`);
  return j;
}

function copilot(fake: FakeCore, change: (c: CopilotStatus) => void): CopilotStatus {
  change(fake.world.copilot);
  fake.publish("copilot:status");
  return fake.world.copilot;
}

const skills = new Map<string, { rev: number; body: string }>();
const defaultSkill = (a: AgentView) => `---\nname: ${a.name}\n---\n\nYou are the ${a.name} of the council. Ask one question at a time; cite the call.`;

/** The call a scripted transcript event belongs to, if it names one. */
function scriptCall(e: World["live_script"][number]): string | undefined {
  if ("segment" in e) return e.segment.call_id;
  if ("gap" in e) return e.gap.call_id;
  if ("mark" in e) return e.mark.call_id;
  if ("segments" in e) return e.segments[0]?.call_id;
  if ("speakers" in e) return e.speakers[0]?.call_id;
  return undefined;
}

// ── handlers ─────────────────────────────────────────────────────────────

export const defaultHandlers: Handlers = {
  // ── App ──────────────────────────────────────────────────────────────
  app_snapshot: (_a, { world, window }) => ({ ...world.app, copilot: world.app.copilot ? world.copilot : null, window }),
  stream_unsubscribe: (a, { fake }) => {
    fake.closeChannel(a.subscription_id, "unsubscribed");
    return ack;
  },
  stream_ack: (a, { fake }) => {
    fake.acks.set(a.subscription_id, Math.max(fake.acks.get(a.subscription_id) ?? 0, a.seq));
    return ack;
  },
  log_ui: () => ack,
  banner_dismiss: (a, { world, publish }) => {
    world.app.banners.banners = world.app.banners.banners.filter((b) => b.type !== a.banner);
    publish("banners:changed");
    return world.app.banners;
  },

  // ── Capture ──────────────────────────────────────────────────────────
  // O1: a start is never gated on setup, permissions or the self-test.
  capture_start: (a, { world, fake, publish }) => {
    const cap = world.app.capture;
    if (live(cap) || cap.phase === "stopping") throw coreError("already_recording");
    const free = world.app.environment.disk_free_mb;
    if (free < 500) throw coreError("disk_full", "under 500 MB", { type: "disk_space", free_mb: free, needed_mb: 500 });
    if (world.app.setup.models.bundles.some((b) => b.required_for_capture && b.state !== "ready")) throw coreError("model_missing");
    if (a.source === "record_prompt" && a.detection_id) {
      const d = world.app.detection.detection;
      if (d?.id !== a.detection_id || now() >= d.prompt_until) throw coreError("detection_expired");
    }
    if (fake.playback.playing) {
      Object.assign(fake.playback, { playing: false, stopped_reason: "capture_started" });
      publish("playback:state");
    }
    const id = newId("call");
    const banners = world.app.banners.banners;
    if (banners.some((b) => b.type === "recording_interrupted_by_quit")) {
      world.app.banners.banners = banners.filter((b) => b.type !== "recording_interrupted_by_quit");
      publish("banners:changed");
    }
    if (world.app.detection.detection) {
      world.app.detection.detection = null;
      publish("capture:detected");
    }
    return setCapture(fake, {
      phase: "recording",
      call_id: id,
      title: "New call",
      started_at: now(),
      recorded_ms: 0,
      sensitive: a.sensitive,
      pause: null,
      notice: null,
      continue_until: null,
      audio_writing: free >= 500,
    });
  },
  capture_stop: (a, { world, fake }) => {
    requireLive(world.app.capture, a.call_id);
    return setCapture(fake, { phase: "stopped", pause: null, notice: null, continue_until: now() + 5 * MIN });
  },
  capture_set_paused: (a, { world, fake }) => {
    const cap = world.app.capture;
    // A stopped call is not resumed by un-pausing: that is Continue Recording.
    if (cap.call_id !== a.call_id || (cap.phase !== "recording" && cap.phase !== "paused")) throw coreError("not_recording");
    return setCapture(fake, { phase: a.paused ? "paused" : "recording", pause: a.paused ? { since: now(), remind_at: now() + 5 * MIN } : null });
  },
  capture_mark_moment: (a, { world, fake }) => {
    requireLive(world.app.capture, a.call_id);
    const mark = { id: newId("mrk"), call_id: a.call_id, at_ms: world.app.capture.recorded_ms, note: a.note ?? null };
    fake.push("transcript_subscribe", { event: { type: "mark", mark } });
    return mark;
  },
  capture_answer_call_end: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "call_ended") throw coreError("notice_expired");
    return a.choice === "keep_recording"
      ? setCapture(fake, { notice: null })
      : setCapture(fake, { phase: "stopped", notice: null, continue_until: now() + 5 * MIN });
  },
  capture_hold_notice: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "call_ended") throw coreError("notice_expired");
    return setCapture(fake, { notice: { type: "call_ended", stops_at: a.held ? null : now() + 10_000 } });
  },
  capture_continue: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || cap.phase !== "stopped" || !cap.continue_until || cap.continue_until < now()) throw coreError("continue_window_closed");
    return setCapture(fake, { phase: "recording", continue_until: null, notice: null });
  },
  capture_resume_interrupted: (a, { world, fake, publish }) => {
    const cap = world.app.capture;
    if (cap.phase === "failed" && cap.call_id === a.call_id) {
      // Try Again after the engine stopped: same call, gap row engine_restart.
      world.app.degraded.states = world.app.degraded.states.filter((d) => d.type !== "capture_failed");
      publish("degraded:changed");
      const t = world.transcripts.find((x) => x.call_id === a.call_id);
      const at = t?.segments.at(-1)?.t1_ms ?? 0;
      t?.gaps.push({ call_id: a.call_id, t0_ms: at, t1_ms: at + 2_000, reason: "engine_restart" });
      return setCapture(fake, { phase: "recording", notice: null });
    }
    const banner = world.app.banners.banners.find((b) => b.type === "recording_interrupted_by_quit" && b.call.id === a.call_id);
    if (!banner || banner.type !== "recording_interrupted_by_quit") throw coreError("notice_expired", "the interrupted recording can no longer be resumed");
    if (live(cap)) throw coreError("already_recording");
    world.app.banners.banners = world.app.banners.banners.filter((b) => b !== banner);
    publish("banners:changed");
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    const at = t?.segments.at(-1)?.t1_ms ?? 0;
    t?.gaps.push({ call_id: a.call_id, t0_ms: at, t1_ms: at + 2_000, reason: "interrupted" });
    return setCapture(fake, { phase: "recording", call_id: a.call_id, title: banner.call.title, started_at: banner.call.started_at, pause: null, notice: null, continue_until: null });
  },
  capture_answer_new_meeting: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "new_meeting") throw coreError("notice_expired");
    if (a.choice === "keep_in_this_call") return setCapture(fake, { notice: null });
    const title = cap.notice.event?.title ?? "New call";
    const id = newId("call");
    const started_at = cap.notice.detected_at;
    // Like the real core: the new call has its row and an empty live transcript at once (D-37).
    const template = world.calls.find((c) => c.id === cap.call_id) ?? world.calls[0];
    if (template) {
      const row = { ...template, id, rev: 1, title, started_at, duration_ms: 0, participants: [], unnamed_speakers: 0, languages: [], tags: [], audio_kept_until: null, audio_deleted: false, open_items: 0, review_waiting: 0 };
      world.calls = [row, ...world.calls];
    }
    world.transcripts.push({ subscription_id: null, call_id: id, live: true, pass: "live", archive: "not_started", segments: [], hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: 0, audio_available: true });
    return setCapture(fake, { call_id: id, title, started_at, recorded_ms: 0, notice: null });
  },
  capture_keep_recording: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "nothing_heard") throw coreError("notice_expired");
    return setCapture(fake, { notice: null });
  },
  capture_discard: (a, { world, fake }) => {
    requireLive(world.app.capture, a.call_id);
    world.calls = world.calls.filter((c) => c.id !== a.call_id);
    return setCapture(fake, { phase: "idle", call_id: null, title: null, started_at: null, recorded_ms: 0, pause: null, notice: null, continue_until: null });
  },
  capture_set_sensitive: (a, { world, fake, emit }) => {
    const cap = world.app.capture;
    const capturing = cap.call_id === a.call_id && live(cap);
    if (capturing && !a.sensitive) {
      throw coreError("invalid_input", "a call can only be made sensitive during capture", { type: "validation", field: "sensitive", rule: "out_of_range" });
    }
    const row = world.calls.find((c) => c.id === a.call_id);
    // The row and its details are one record in the real core: both change, and windows hear it (D-37).
    const detail = world.call_details.find((d) => d.call.id === a.call_id)?.call;
    for (const c of [row, detail]) if (c) c.privacy = a.sensitive ? "sensitive" : "normal";
    if (detail ?? row) emit("entity:changed", { type: "call", call: (detail ?? row)! });
    if (capturing || cap.call_id === a.call_id) return setCapture(fake, { sensitive: a.sensitive });
    if (!row) throw coreError("not_found", `call ${a.call_id}`);
    return cap;
  },
  capture_exclude_source: (a, { world, fake, publish }) => {
    requireLive(world.app.capture, a.call_id);
    world.app.degraded.states = world.app.degraded.states.filter((d) => !(d.type === "second_audio_source" && d.bundle_id === a.bundle_id));
    publish("degraded:changed");
    return fake.world.app.capture;
  },
  capture_keep_source: (a, { world, publish }) => {
    requireLive(world.app.capture, a.call_id);
    const before = world.app.degraded.states.length;
    world.app.degraded.states = world.app.degraded.states.filter((d) => !(d.type === "second_audio_source" && d.bundle_id === a.bundle_id));
    if (world.app.degraded.states.length === before) throw coreError("notice_expired", `no second source ${a.bundle_id}`);
    publish("degraded:changed");
    return world.app.capture;
  },
  capture_dismiss_detection: (a, { world, publish }) => {
    const detection = world.app.detection.detection;
    if (detection?.id !== a.detection_id) throw coreError("detection_expired");
    // The prompt closes; the detection stays for the menu bar while the app holds audio (D-38).
    detection.prompt_until = now();
    publish("capture:detected");
    return ack;
  },
  capture_ignore_app: (a, { world, publish }) => {
    world.settings.general.ignored_apps.push({ bundle_id: a.bundle_id, app_name: a.app_name });
    world.app.detection.detection = null;
    publish("capture:detected");
    publish("settings:changed");
    return ack;
  },

  // ── Transcript ───────────────────────────────────────────────────────
  transcript_subscribe: (a, { world, fake, send }) => {
    const snap = world.transcripts.find((t) => t.call_id === a.call_id);
    if (!snap) {
      const c = call(world, a.call_id);
      return { subscription_id: null, call_id: c.id, live: false, pass: "archive", archive: c.archive, segments: [], hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: 0, audio_available: !c.audio_deleted };
    }
    const isLive = snap.live && world.app.capture.call_id === a.call_id && live(world.app.capture);
    if (!isLive) return { ...snap, subscription_id: null, live: false };
    const sub = newId("sub");
    fake.openChannel(sub, "transcript_subscribe", send as (m: unknown) => void, snap.last_seq);
    // Like the real core, messages can reach the page before this snapshot resolves: one the
    // snapshot already contains (seq = last_seq) and the first new one. The client drops the
    // first and holds the second until the snapshot is in (R23).
    // The script is the fixture call's speech: a call started at runtime waits for its own (D-37).
    const [first, ...rest] = world.live_script.filter((e) => scriptCall(e) === undefined || scriptCall(e) === a.call_id);
    send({ seq: snap.last_seq, event: { type: "segments_updated", segments: snap.segments.slice(-1) } });
    if (first) fake.push(sub, { event: first });
    rest.forEach((event, i) => fake.later((i + 1) * world.script_interval_ms, () => fake.push(sub, { event })));
    return { ...snap, subscription_id: sub };
  },
  levels_subscribe: (_a, { fake, send }) => {
    const sub = newId("sub");
    fake.openChannel(sub, "levels_subscribe", send as (m: unknown) => void);
    let t = 0;
    const tick = () => {
      t += 100;
      if (fake.push(sub, { at_ms: t, mic_db: -30 - Math.random() * 20, sys_db: -25 - Math.random() * 20 }) !== null && t < 30_000) fake.later(100, tick);
    };
    fake.later(100, tick);
    return { subscription_id: sub };
  },
  transcript_rename_speaker: (a, { world, emit }) => {
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    const spk = t?.speakers.find((s) => s.id === a.speaker_id);
    if (!t || !spk) throw coreError("not_found");
    const p = a.person.type === "existing" ? person(world, a.person.person_id) : undefined;
    const name = p?.display_name ?? (a.person.type === "new" ? a.person.display_name : "Unknown");
    if (!name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "person", rule: "required" });
    spk.label = { type: "person", person: { id: p?.id ?? newId("per"), display_name: name, short_name: p?.short_name ?? name, initials: p?.initials ?? name.slice(0, 2).toUpperCase(), is_you: p?.is_you ?? false } };
    spk.named_by = "you";
    emit("entity:changed", { type: "speakers", call_id: a.call_id, speakers: t.speakers });
    const change_id = logChange(world, { entity: { kind: "speaker", id: spk.id, label: name }, field: "person", after: name, summary: `Named a speaker as ${name}` });
    return { speakers: [spk], change_id };
  },
  transcript_fix_term: (a, { world, fake }) => {
    const seg = world.transcripts.flatMap((t) => t.segments).find((s) => s.id === a.segment_id);
    if (!seg) throw coreError("not_found");
    if (!a.replacement.trim()) throw coreError("invalid_input", "replacement", { type: "validation", field: "replacement", rule: "required" });
    const original = seg.text.slice(a.range.start, a.range.end);
    seg.text = seg.text.slice(0, a.range.start) + a.replacement + seg.text.slice(a.range.end);
    seg.corrections.push({ range: { start: a.range.start, end: a.range.start + a.replacement.length }, original });
    fake.push("transcript_subscribe", { event: { type: "segments_updated", segments: [seg] } });
    const change_id = logChange(world, { entity: { kind: "segment", id: seg.id, label: "Transcript line" }, field: "text", before: original, after: a.replacement, summary: `Fixed “${original}” to “${a.replacement}”` });
    return { segment: seg, change_id, glossary_term_id: a.add_to_glossary ? newId("gls") : null, proposal_queued: a.add_to_glossary };
  },
  transcript_name_speakers: (a, { world, emit }) => {
    const t = world.transcripts.find((x) => x.call_id === a.call_id) ?? world.call_details.find((d) => d.call.id === a.call_id);
    if (!t) throw coreError("not_found", `call ${a.call_id}`);
    const named = a.assignments.flatMap((as) => {
      const spk = t.speakers.find((s) => s.id === as.speaker_id);
      if (!spk) throw coreError("not_found", `speaker ${as.speaker_id}`);
      if (!as.person) return [];
      const p = as.person.type === "existing" ? person(world, as.person.person_id) : null;
      const name = p?.display_name ?? (as.person.type === "new" ? as.person.display_name : "Unknown");
      spk.label = { type: "person", person: { id: p?.id ?? newId("per"), display_name: name, short_name: p?.short_name ?? name, initials: p?.initials ?? name.slice(0, 2).toUpperCase(), is_you: false } };
      spk.named_by = "you";
      return [spk];
    });
    emit("entity:changed", { type: "speakers", call_id: a.call_id, speakers: t.speakers });
    return { speakers: named, change_id: logChange(world, { entity: { kind: "call", id: a.call_id, label: "Speakers" }, field: "speakers", summary: `Named ${named.length} speakers` }) };
  },
  transcript_span: (a, { world }) => {
    const t = world.transcripts.find((x) => x.call_id === a.span.call_id);
    const c = call(world, a.span.call_id);
    return {
      span: a.span,
      call: callRef(c),
      segments: (t?.segments ?? []).filter((s) => s.t1_ms >= a.span.t0_ms && s.t0_ms <= a.span.t1_ms),
      audio_available: !c.audio_deleted,
      upgraded_by_archive: false,
    };
  },
  audio_play: (a, { world, fake, publish }) => {
    if (call(world, a.call_id).audio_deleted) throw coreError("audio_deleted");
    const cap = world.app.capture;
    const env = world.app.environment;
    if (live(cap)) {
      if (!world.settings.audio.exclude_own_sounds) throw coreError("own_sounds_not_excluded");
      if (env.output_route === "speakers") throw coreError("replay_needs_headphones");
      const marked = env.output_device ? world.settings.audio.output.headphones_devices.includes(env.output_device.uid) : false;
      if (env.output_route === "unknown" && !marked) throw coreError("output_route_unknown");
    }
    Object.assign(fake.playback, { playing: true, call_id: a.call_id, position_ms: a.from_ms, to_ms: a.to_ms ?? null, route: env.output_route, stopped_reason: null });
    publish("playback:state");
    fake.later(3000, () => {
      if (fake.playback.playing && fake.playback.call_id === a.call_id) {
        Object.assign(fake.playback, { playing: false, stopped_reason: "ended" });
        publish("playback:state");
      }
    });
    return fake.playback;
  },
  audio_stop: (_a, { fake, publish }) => {
    if (fake.playback.playing) {
      Object.assign(fake.playback, { playing: false, stopped_reason: "user" });
      publish("playback:state");
    }
    return fake.playback;
  },
  audio_delete: (a, { world, emit }) => {
    const calls = a.call_ids.map((id) => call(world, id)).filter((c) => !c.audio_deleted);
    calls.forEach((c) => {
      c.audio_deleted = true;
      c.audio_kept_until = null;
      emit("entity:changed", { type: "call", call: c });
    });
    return { calls: calls.length, freed_mb: calls.length * 58 };
  },
  audio_delete_older: (a, { world }) => {
    if (a.older_than_days < 1) throw coreError("invalid_input", "days", { type: "validation", field: "older_than_days", rule: "out_of_range" });
    const cutoff = world.now - a.older_than_days * 86_400_000;
    const calls = world.calls.filter((c) => !c.audio_deleted && c.started_at < cutoff);
    calls.forEach((c) => (c.audio_deleted = true));
    return { calls: calls.length, freed_mb: calls.length * 58 };
  },

  // ── Copilot (draft) ──────────────────────────────────────────────────
  cards_subscribe: (a, { world, fake, send }) => {
    const isLive = world.app.capture.call_id === a.call_id && live(world.app.capture);
    const sub = isLive ? newId("sub") : null;
    if (sub) fake.openChannel(sub, "cards_subscribe", send as (m: unknown) => void, 0);
    return {
      subscription_id: sub,
      call_id: a.call_id,
      visible: world.cards.filter((c) => c.call_id === a.call_id && c.number !== null),
      earlier: world.cards.filter((c) => c.call_id === a.call_id && c.number === null),
      pinned: world.items.filter((i) => i.call.id === a.call_id && i.created_by === "pin"),
      status: world.copilot,
      last_seq: 0,
    };
  },
  card_pin: (a, { world, fake }) => {
    const card = findCard(world, a.card_id);
    if (card.state === "expired" || card.state === "dismissed") throw coreError("card_gone");
    const c = call(world, card.call_id);
    const item: ItemView = { ...world.items[0], id: newId("itm"), rev: 1, call: callRef(c), kind: "action_item", text: card.title, created_by: "pin", review: "accepted", status: "open", edited: false };
    cardAction(world, card, item);
    card.state = "pinned";
    world.items.push(item);
    pushCards(fake, { event: { type: "updated", card } });
    return { card, item, change_id: logChange(world, { entity: { kind: "item", id: item.id, label: item.text }, summary: "Pinned a card" }) };
  },
  card_dismiss: (a, { world, fake }) => {
    const card = findCard(world, a.card_id);
    if (card.state === "expired" || card.state === "dismissed") throw coreError("card_gone");
    cardAction(world, card, null);
    card.state = "dismissed";
    card.number = null;
    pushCards(fake, { event: { type: "removed", card_id: card.id, state: "dismissed" } });
    return { card, item: null, change_id: null };
  },
  card_unpin: (a, { world, fake }) => {
    const card = findCard(world, a.card_id);
    if (card.state !== "pinned") throw coreError("invalid_input", "card is not pinned", { type: "validation", field: "card_id", rule: "invalid_format" });
    const item = world.items.find((i) => i.created_by === "pin" && i.text === card.title) ?? null;
    if (item) world.items = world.items.filter((i) => i !== item);
    card.state = "shown";
    pushCards(fake, { event: { type: "updated", card } });
    return { card, item: null, change_id: item ? logChange(world, { entity: { kind: "item", id: item.id, label: item.text }, summary: "Unpinned a card" }) : null };
  },
  card_undo_last: (a, { world, fake }) => {
    const last = lastCardAction;
    const card = last ? world.cards.find((c) => c.id === last.card_id && c.call_id === a.call_id) : undefined;
    if (!last || !card) throw coreError("not_found", "no card action to undo");
    if (now() - last.at > 30_000) throw coreError("undo_expired", "card undo is 30 seconds");
    card.state = last.state;
    card.number = last.number;
    if (last.item_id) world.items = world.items.filter((i) => i.id !== last.item_id);
    lastCardAction = null;
    pushCards(fake, { event: { type: "updated", card } });
    return { card, item: null, change_id: null };
  },
  card_set_held: (a, { world }) => {
    const card = findCard(world, a.card_id);
    if (a.held && card.state === "shown") card.state = "held";
    if (!a.held && card.state === "held") card.state = "shown";
    return ack;
  },
  card_rate: (a, { world }) => {
    const card = findCard(world, a.card_id);
    card.rating = a.rating ?? null;
    return { card, item: null, change_id: null };
  },
  card_shown: (a, { world }) => {
    findCard(world, a.card_id);
    return ack;
  },
  copilot_catch_up: (a, { world, fake }) => {
    requireLive(world.app.capture, a.call_id);
    if (world.copilot.muted) throw coreError("copilot_off");
    const card: CardView = { ...world.cards[0], id: newId("card"), call_id: a.call_id, number: 1, kind: "catch_up", solicited: true, provenance: null, state: "streaming", title: "Last 5 minutes: drawer scope kept at 480 pt; reconnect owner still open.", created_at: now(), used: false };
    fake.later(800, () => {
      world.cards.unshift(card);
      pushCards(fake, { event: { type: "added", card } });
    });
    return ack;
  },
  copilot_ask_about_call: (a, { world, fake }) => {
    requireLive(world.app.capture, a.call_id);
    if (!a.question.trim()) throw coreError("invalid_input", "question", { type: "validation", field: "question", rule: "required" });
    const card: CardView = { ...world.cards[0], id: newId("card"), call_id: a.call_id, number: 1, kind: "answer", solicited: true, state: "shown", title: "Dmitri S. owns the replay buffer (VSTOR-9912).", provenance: { type: "this_call", span: { call_id: a.call_id, channel: "sys", t0_ms: 1_361_000, t1_ms: 1_367_000 } }, created_at: now(), used: false };
    fake.later(1200, () => {
      world.cards.unshift(card);
      pushCards(fake, { event: { type: "added", card } });
    });
    return ack;
  },
  copilot_mute: (a, { fake }) =>
    copilot(fake, (c) => {
      c.muted = a.scope.type === "off" ? null : { scope: a.scope, until: a.scope.type === "for_minutes" ? now() + a.scope.minutes * MIN : null };
      c.card_keys.registered = c.muted === null && live(fake.world.app.capture) && !fake.world.app.presenting.hidden;
    }),
  copilot_mute_agent: (a, { fake }) =>
    copilot(fake, (c) => {
      const row = c.agents.find((x) => x.agent.id === a.agent_id);
      if (!row) throw coreError("not_found", `agent ${a.agent_id}`);
      row.muted = a.muted;
    }),
  copilot_raise_budget: (a, { fake }) =>
    copilot(fake, (c) => {
      const cap = a.cap_usd ?? 0;
      if (!(cap > (c.budget.cap_usd ?? 0))) throw coreError("invalid_input", "cap must go up", { type: "validation", field: "cap_usd", rule: "out_of_range" });
      c.budget.cap_usd = cap;
      c.budget.level = (c.budget.spent_usd ?? 0) > 0.9 * cap ? "near" : "ok";
    }),
  // Screen context chips are v1.x.
  context_chip_set: () => {
    throw coreError("feature_disabled", "screen context chips are v1.x");
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
        (!f.person_id || i.owner?.id === f.person_id) &&
        (!f.topic_id || i.topic?.id === f.topic_id) &&
        (!f.due_before || (i.due !== null && i.due < f.due_before)),
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
    return itemChanged(world, item, emit, a.done ? "Ticked an item" : "Unticked an item", "status", before);
  },
  item_review: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    const before = item.review;
    item.review = a.decision === "accept" ? "accepted" : a.decision === "reject" ? "rejected" : "suggested";
    return itemChanged(world, item, emit, `Review: ${item.review}`, "review", before);
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
    if (a.patch.owner) {
      const o = a.patch.owner;
      item.owner = o.type === "clear" ? null : o.person.type === "existing" ? (() => { const p = person(world, (o.person as { person_id: string }).person_id); return { id: p.id, display_name: p.display_name, short_name: p.short_name, initials: p.initials, is_you: p.is_you }; })() : { id: newId("per"), display_name: o.person.display_name, short_name: o.person.display_name, initials: o.person.display_name.slice(0, 2).toUpperCase(), is_you: false };
    }
    if (a.patch.topic_id) item.topic = { id: a.patch.topic_id, name: topic(world, a.patch.topic_id).name };
    return itemChanged(world, item, emit, "Edited an item", "text", before);
  },
  item_reopen: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    if (item.status === "open") throw coreError("invalid_input", "already open", { type: "validation", field: "item_id", rule: "invalid_format" });
    const before = item.status;
    item.status = "open";
    item.closed_by = null;
    item.done_at = null;
    return itemChanged(world, item, emit, "Reopened an item", "status", before);
  },
  item_create: (a, { world, emit }) => {
    if (!a.text.trim()) throw coreError("invalid_input", "text required", { type: "validation", field: "text", rule: "required" });
    const c = call(world, a.call_id);
    const owner = a.owner?.type === "existing" ? person(world, a.owner.person_id) : null;
    const item: ItemView = {
      ...world.items[0],
      id: newId("itm"),
      rev: 0,
      call: callRef(c),
      kind: a.kind,
      text: a.text,
      owner: owner ? { id: owner.id, display_name: owner.display_name, short_name: owner.short_name, initials: owner.initials, is_you: owner.is_you } : null,
      due: a.due ?? null,
      status: "open",
      review: "accepted",
      created_by: "user",
      spans: a.span ? [a.span] : [],
      handoff: null,
      closed_by: null,
      done_at: null,
      owed: owner?.is_you ? "by_you" : "to_you",
      edited: false,
      linked_issue: null,
      is_engineering: false,
    };
    world.items.push(item);
    return itemChanged(world, item, emit, "Added an item", null, null);
  },
  item_answer_handoff_landed: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    checkRev(item.rev, a.rev);
    if (item.status !== "handed_off") throw coreError("invalid_input", "item is not handed off", { type: "validation", field: "item_id", rule: "invalid_format" });
    if (a.answer === "landed" || a.answer === "done_another_way") {
      item.status = "done";
      item.done_at = now();
    }
    return itemChanged(world, item, emit, `Handoff: ${a.answer.replace(/_/g, " ")}`, "status", "handed_off");
  },

  // ── Today ────────────────────────────────────────────────────────────
  today_get: (_a, { world }) => ({ ...world.today, ranking: world.settings.today.ranking }),

  // ── Outputs and sharing ──────────────────────────────────────────────
  outputs_get: (a, { world }) => {
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    if (out) return out;
    const c = call(world, a.call_id);
    return { call_id: c.id, status: "not_started", sections: [], archive: c.archive, review_waiting: c.review_waiting, sensitive: c.privacy === "sensitive", written_locally: false };
  },
  output_edit: (a, { world }) => {
    const s = section(world, a.summary_id);
    if (s.rev !== null) checkRev(s.rev, a.rev);
    const before = s.body_md;
    s.body_md = a.body_md;
    s.user_edited = true;
    s.rev = (s.rev ?? 0) + 1;
    s.version_count += 1;
    return { section: s, change_id: logChange(world, { entity: { kind: "summary", id: a.summary_id, label: "Summary" }, field: "body", before, after: a.body_md, summary: "Edited the summary" }) };
  },
  // D2: post-call analysis may run during a live call; regeneration waits.
  outputs_regenerate: (a, { world, fake, emit }) => {
    call(world, a.call_id);
    if (live(world.app.capture)) throw coreError("job_blocked", "regeneration waits for the live call to end");
    if (!a.sections.length) throw coreError("invalid_input", "sections", { type: "validation", field: "sections", rule: "required" });
    const run = newId("run");
    a.sections.forEach((kind, i) => {
      fake.later(300 * (i + 1), () => emit("outputs:progress", { call_id: a.call_id, status: "writing", section: kind, state: { type: "writing" } }));
      fake.later(300 * (i + 2), () => emit("outputs:progress", { call_id: a.call_id, status: "ready", section: kind, state: { type: "ready" } }));
    });
    return { job_run_id: run };
  },
  output_versions: (a, { world }) => {
    const s = section(world, a.summary_id);
    const versions = Array.from({ length: Math.max(1, s.version_count) }, (_, i) => ({
      id: `ver_${a.summary_id}_${i + 1}`,
      n: i + 1,
      kind: i === 0 || !s.user_edited ? ("generated" as const) : ("user_edit" as const),
      writer: s.writer,
      created_at: (s.writer?.generated_at ?? world.now) + i * MIN,
    }));
    return { versions: versions.reverse() };
  },
  output_version_get: (a, { world }) => {
    const s = section(world, a.summary_id);
    const n = Number(a.version_id.split("_").at(-1));
    if (!n || n > Math.max(1, s.version_count)) throw coreError("not_found", `version ${a.version_id}`);
    return { meta: { id: a.version_id, n, kind: n === 1 ? "generated" : s.user_edited ? "user_edit" : "generated", writer: s.writer, created_at: (s.writer?.generated_at ?? world.now) + (n - 1) * MIN }, body_md: n === s.version_count ? (s.body_md ?? "") : `${s.body_md ?? ""}\n\n(Version ${n}.)` };
  },
  share_copy: (a, { world }) => {
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    if (!out || out.status === "writing" || out.status === "not_started") throw coreError("outputs_not_ready");
    const sections = out.sections.filter((s) => !a.scope.sections.length || a.scope.sections.includes(s.kind));
    const items = sections.flatMap((s) => s.items).filter((i) => !a.scope.item_ids.length || a.scope.item_ids.includes(i.id));
    const unreviewed = items.filter((i) => i.review === "suggested").length;
    if (unreviewed && !a.scope.include_unreviewed) throw coreError("unreviewed_in_scope");
    const text = sections.map((s) => s.body_md ?? s.items.map((i) => `- ${i.text}`).join("\n")).join("\n\n");
    return { text, sections: sections.length, items: items.length, unreviewed_in_scope: unreviewed, sensitive: out.sensitive };
  },
  calls_export: (a, { world }) => {
    if (!a.call_ids.length) throw coreError("invalid_input", "call_ids", { type: "validation", field: "call_ids", rule: "required" });
    const calls = a.call_ids.map((id) => call(world, id));
    const per = (a.include.summary_and_items ? 2 : 0) + (a.include.transcript ? 2 : 0) + (a.include.audio ? 2 : 0);
    const files = a.scope ? calls.length : calls.length * Math.max(1, per);
    return { path: `~/Downloads/Noter export ${new Date(world.now).toISOString().slice(0, 10)}`, files };
  },

  // ── Handoff ──────────────────────────────────────────────────────────
  handoff_get: (a, { world }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    return handoffView(world, item, handoffGenerating.has(item.id) ? { type: "generating" } : { type: "ready" });
  },
  // Returns at once with `generating`; the finished view arrives through `entity:changed`.
  handoff_generate: (a, { world, fake, emit }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    if (!a.regenerate && !handoffGenerating.has(item.id) && handoffRevs.has(item.id)) return handoffView(world, item);
    handoffGenerating.add(item.id);
    fake.later(1500, () => {
      if (!handoffGenerating.delete(item.id)) return;
      handoffRevs.set(item.id, (handoffRevs.get(item.id) ?? 0) + 1);
      handoffEdits.delete(item.id);
      emit("entity:changed", { type: "handoff", handoff: handoffView(world, item) });
    });
    return handoffView(world, item, { type: "generating" });
  },
  handoff_cancel: (a, { world }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    handoffGenerating.delete(item.id);
    return handoffView(world, item, handoffRevs.has(item.id) ? { type: "ready" } : { type: "not_generated" });
  },
  handoff_edit: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    checkRev(handoffRevs.get(item.id) ?? 1, a.rev);
    if (!a.prompt_md.trim()) throw coreError("invalid_input", "prompt", { type: "validation", field: "prompt_md", rule: "required" });
    handoffEdits.set(item.id, a.prompt_md);
    handoffRevs.set(item.id, a.rev + 1);
    const view = handoffView(world, item);
    emit("entity:changed", { type: "handoff", handoff: view });
    return view;
  },
  handoff_set_target: (a, { world }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    handoffTargets.set(item.id, a.target);
    return handoffView(world, item);
  },
  // Opening or copying a handoff accepts a suggested item.
  handoff_open: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    const repo = world.repos.mappings.find((m) => item.linked_issue?.startsWith(m.key));
    if (!repo) throw coreError("repo_not_mapped");
    if (!repo.path_exists) throw coreError("repo_path_missing");
    const target = handoffTargets.get(item.id) ?? repo.default_tool;
    item.status = "handed_off";
    item.review = "accepted";
    item.handoff = { target, at: now(), cwd: repo.local_path, awaiting: true };
    bump(item);
    emit("entity:changed", { type: "item", item });
    return { path_used: target === "codex" ? "codex_app" : "claude_cli_link", item, prompt_file: `handoffs/${item.id}.md` };
  },
  handoff_copy: (a, { world, emit }) => {
    const item = findItem(world, a.item_id);
    requireEngineering(item);
    if (item.review === "suggested") {
      item.review = "accepted";
      bump(item);
      emit("entity:changed", { type: "item", item });
    }
    return { chars: (handoffView(world, item).prompt_md ?? "").length, item };
  },

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
    return { rows, next_cursor: null, total: rows.length };
  },
  call_get: (a, { world }) => {
    const d = world.call_details.find((x) => x.call.id === a.call_id);
    if (d) return d;
    const c = call(world, a.call_id);
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    return { call: c, calendar_event: null, speakers: t?.speakers ?? [], marks: t?.marks ?? [], gaps: t?.gaps ?? [], mode_used: world.app.privacy.effective, audio_not_stored: false, first_recorded_call: false, folder: `/Users/you/Library/Application Support/Noter/audio/${a.call_id}` };
  },
  call_update: (a, { world, emit }) => {
    const c = call(world, a.call_id);
    checkRev(c.rev, a.rev);
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
    return { call: c, change_id: logChange(world, { entity: { kind: "call", id: c.id, label: c.title }, field: "title", before, after: c.title, summary: "Changed call info" }) };
  },
  call_tags_set: (a, { world }) => {
    for (const t of a.add) if (t.length < 1 || t.length > 32) throw coreError("invalid_input", "tag length", { type: "validation", field: "add", rule: t.length ? "too_long" : "too_short" });
    const calls = a.call_ids.map((id) => {
      const c = call(world, id);
      c.tags = [...new Set([...c.tags.filter((t) => !a.remove.includes(t)), ...a.add])];
      return c;
    });
    return { calls, change_id: logChange(world, { entity: { kind: "call", id: a.call_ids[0], label: "Tags" }, field: "tags", after: a.add.join(", "), summary: "Changed tags" }) };
  },
  tags_list: (_a, { world }) => {
    const counts = new Map<string, number>();
    world.calls.forEach((c) => c.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return { tags: [...counts].map(([tag, calls]) => ({ tag, calls })) };
  },
  calls_delete: (a, { world, emit }) => {
    const ids = new Set(a.call_ids.filter((id) => world.calls.some((c) => c.id === id)));
    if (world.app.capture.call_id && ids.has(world.app.capture.call_id) && live(world.app.capture)) throw coreError("already_recording", "stop the call before deleting it");
    world.calls = world.calls.filter((c) => !ids.has(c.id));
    world.call_details = world.call_details.filter((d) => !ids.has(d.call.id));
    world.transcripts = world.transcripts.filter((t) => !ids.has(t.call_id));
    ids.forEach((id) => emit("entity:changed", { type: "removed", kind: "call", id }));
    return { deleted: ids.size };
  },
  call_types_list: (_a, { world }) => world.call_types,
  search: (a, { world }) => {
    const q = a.query.toLowerCase();
    const segs = world.transcripts.flatMap((t) => t.segments).filter((s) => s.text.toLowerCase().includes(q));
    const items = world.items.filter((i) => i.text.toLowerCase().includes(q));
    const callOf = (id: string) => callRef(call(world, id));
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
    fake.later(200, () => fake.push(sub, { event: { type: "started", runtime: "claude_api_key", mode: world.app.privacy.effective } }));
    words.forEach((w, i) => fake.later(400 + i * 60, () => fake.push(sub, { event: { type: "delta", text: (i ? " " : "") + w } })));
    if (cite) fake.later(400 + words.length * 60, () => fake.push(sub, { event: { type: "citation", citation: cite } }));
    fake.later(400 + words.length * 60 + 100, () => {
      const answer = { turn_id: turn, question: a.question, answer_md: words.join(" "), citations: cite ? [cite] : [], found: true, runtime: "claude_api_key" as const, answered_locally: false, sensitive_sources_skipped: 0, keyword_only: false, only_weak_evidence: false, asked_at: now() };
      const existing = world.ask_threads.find((t) => t.id === thread);
      if (existing) existing.turns.push(answer);
      else world.ask_threads.unshift({ id: thread, title: a.question, scope: a.scope, turns: [answer] });
      fake.push(sub, { event: { type: "done", answer } });
      fake.push(sub, { event: { type: "ended", reason: "call_stopped" } });
      fake.closeChannel(sub);
    });
    return { thread_id: thread, turn_id: turn, subscription_id: sub };
  },
  ask_stop: (a, { fake }) => {
    const sub = fake.latestSubscription("ask_start");
    if (sub) {
      fake.push(sub, { event: { type: "failed", error: coreError("answer_stopped", `turn ${a.turn_id} stopped`) } });
      fake.push(sub, { event: { type: "ended", reason: "unsubscribed" } });
      fake.closeChannel(sub);
    }
    return ack;
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
    return ack;
  },
  topics_list: (_a, { world }) => ({ topics: world.topics }),
  topic_get: (a, { world }) => {
    const t = topic(world, a.topic_id);
    const items = world.items.filter((i) => i.topic?.id === t.id);
    const calls = [...new Map(items.map((i) => [i.call.id, i.call])).values()];
    return { topic: t, groups: calls.map((c) => ({ call: c, items: items.filter((i) => i.call.id === c.id) })) };
  },
  topic_rename: (a, { world, emit }) => {
    const t = topic(world, a.topic_id);
    checkRev(t.rev, a.rev);
    if (!a.name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "name", rule: "required" });
    const before = t.name;
    t.aliases = [...new Set([...t.aliases, before])];
    t.name = a.name;
    t.rev += 1;
    emit("entity:changed", { type: "topic", topic: t });
    return { topic: t, change_id: logChange(world, { entity: { kind: "topic", id: t.id, label: t.name }, field: "name", before, after: t.name, summary: `Renamed topic to ${t.name}` }) };
  },
  topics_merge: (a, { world, emit }) => {
    if (a.source === a.target) throw coreError("invalid_input", "same topic", { type: "validation", field: "target", rule: "duplicate" });
    const src = topic(world, a.source);
    const dst = topic(world, a.target);
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
    return { topic: dst, change_id: logChange(world, { entity: { kind: "topic", id: dst.id, label: dst.name }, summary: `Merged ${src.name} into ${dst.name}` }) };
  },
  topics_keep_separate: (a, { world }) => {
    const x = topic(world, a.a);
    const y = topic(world, a.b);
    if (x.merge_suggestion?.id === y.id) x.merge_suggestion = null;
    if (y.merge_suggestion?.id === x.id) y.merge_suggestion = null;
    return ack;
  },

  // ── History and undo ─────────────────────────────────────────────────
  history_list: (a, { world }) => {
    const t = a.target;
    const rows = world.changes.filter(
      (c) =>
        (t.type === "all" || (t.type === "item" && c.entity.id === t.item_id) || (t.type === "call" && c.entity.id === t.call_id) || (t.type === "person" && c.entity.id === t.person_id)) &&
        (a.actor === "all" || (a.actor === "you" && c.actor.type === "you") || (a.actor === "jobs" && c.actor.type === "job") || (a.actor === "models" && c.actor.type === "model")) &&
        (!a.job_id || (c.actor.type === "job" && c.actor.job_id === a.job_id)),
    );
    return { rows, next_cursor: null, total: rows.length };
  },
  change_undo: (a, { world }) => {
    const target = a.target;
    const rows = world.changes.filter((c) => (target.type === "change" ? c.id === target.change_id : c.batch_id === target.batch_id));
    if (!rows.length) throw coreError("not_found");
    if (rows.every((r) => r.status === "undone")) throw coreError("already_undone");
    if (rows.some((r) => !r.undoable)) throw coreError("not_undoable");
    rows.forEach((r) => Object.assign(r, { status: "undone", undoable: false, redoable: true }));
    return { undone: rows.reduce((n, r) => n + r.batch_size, 0), skipped_edited_later: 0 };
  },
  // Redo by target, at any time, while the rows were not edited later; writes new change rows.
  change_redo: (a, { world }) => {
    const target = a.target;
    const rows = world.changes.filter((c) => (target.type === "change" ? c.id === target.change_id : c.batch_id === target.batch_id));
    if (!rows.length) throw coreError("not_found");
    if (rows.some((r) => r.status !== "undone")) throw coreError("not_undone");
    const redoable = rows.filter((r) => r.redoable);
    if (!redoable.length) throw coreError("edited_later");
    redoable.forEach((r) => Object.assign(r, { status: "applied", undoable: true, redoable: false }));
    logChange(world, { entity: rows[0].entity, summary: `Redid: ${rows[0].summary}`, field: rows[0].field, before: rows[0].before, after: rows[0].after });
    return { undone: redoable.reduce((n, r) => n + r.batch_size, 0), skipped_edited_later: rows.length - redoable.length };
  },
  proposals_list: (a, { world }) => {
    const rows = world.proposals.filter((p) => !a.kinds.length || a.kinds.includes(p.kind));
    return { rows, next_cursor: null, total: rows.length };
  },
  proposal_decide: (a, { world, publish }) => {
    const p = world.proposals.find((x) => x.id === a.proposal_id);
    if (!p) throw coreError("not_found");
    checkRev(p.rev, a.rev);
    world.proposals = world.proposals.filter((x) => x.id !== p.id);
    world.app.proposals.waiting = world.proposals.length;
    publish("proposals:counts");
    return { proposal: p, status: a.decision === "accept" ? "applied" : "rejected", applied: a.decision === "accept" ? p.count : 0, batch_id: p.batch_id };
  },
  proposal_always_for_term: (a, { world }) => {
    const p = world.proposals.find((x) => x.id === a.proposal_id);
    if (!p) throw coreError("not_found");
    if (!p.term) throw coreError("invalid_input", "not a term proposal", { type: "validation", field: "proposal_id", rule: "invalid_format" });
    let term = world.glossary.terms.find((t) => t.term === p.term);
    if (!term) {
      term = { id: newId("gls"), rev: 1, term: p.term, variants_latin: [], variants_cyrillic: [], spoken_forms: [], lang: null, always_apply: false, added_from: null };
      world.glossary.terms.push(term);
    }
    term.always_apply = a.always;
    term.rev += 1;
    return term;
  },
  history_export: (a) => ({ path: `~/Downloads/Noter log ${a.scope.type}.${a.format === "json" ? "json" : "md"}`, files: 1 }),
  activity_get: (a, { world }) => ({
    day: a.day ?? new Date(world.now).toISOString().slice(0, 10),
    needs_attention: world.jobs.jobs.flatMap((j) => (j.last_run?.status === "failed" ? [j.last_run] : [])),
    proposals: world.proposals,
    groups: [{ run: null, changes: world.changes.filter((c) => a.actor === "all" || (a.actor === "you") === (c.actor.type === "you")), total: world.changes.length }],
  }),

  // ── People ───────────────────────────────────────────────────────────
  people_list: (a, { world }) => ({
    people: world.people.filter((p) => !a.query || p.display_name.toLowerCase().includes(a.query.toLowerCase())),
    unnamed: world.transcripts.flatMap((t) =>
      t.speakers.flatMap((s) => (s.label.type === "unnamed" ? [{ call: callRef(call(world, t.call_id)), speaker_id: s.id, n: s.label.n, segment_count: s.segment_count, sample: s.sample, suggestion: s.suggestion }] : [])),
    ),
  }),
  person_get: (a, { world }) => {
    const p = person(world, a.person_id);
    return {
      person: p,
      calls: world.calls.filter((c) => c.participants.some((x) => x.id === p.id)),
      owns_open: world.items.filter((i) => i.owner?.id === p.id && i.status === "open"),
      you_owe: p.is_you ? [] : world.items.filter((i) => i.owner?.is_you && i.status === "open" && i.call.id && i.owed === "by_you"),
      open_questions: world.items.filter((i) => i.kind === "open_question" && i.status === "open"),
      topics: world.topics.slice(0, 2),
      talk_share: world.settings.privacy.behaviour_metrics ? 0.31 : null,
    };
  },
  person_create: (a, { world, emit }) => {
    if (!a.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    if (world.people.some((p) => p.display_name.toLowerCase() === a.display_name.trim().toLowerCase())) throw coreError("invalid_input", "duplicate", { type: "validation", field: "display_name", rule: "duplicate" });
    const p: PersonRow = { ...world.people[1], id: newId("per"), rev: 1, display_name: a.display_name, short_name: a.display_name, initials: a.display_name.slice(0, 2).toUpperCase(), email: a.email ?? null, role: a.role ?? null, org: a.org ?? null, aliases: [], voice_profile: false, open_items: 0, is_you: false, last_call_at: null };
    world.people.push(p);
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: logChange(world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Added ${p.display_name}` }) };
  },
  person_update: (a, { world, emit }) => {
    const p = person(world, a.person_id);
    checkRev(p.rev, a.rev);
    const patch = a.patch;
    if (patch.display_name != null && !patch.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    if (patch.display_name != null) p.display_name = patch.display_name;
    if (patch.short_name != null) p.short_name = patch.short_name;
    if (patch.email !== undefined) p.email = patch.email;
    if (patch.role !== undefined) p.role = patch.role;
    if (patch.org !== undefined) p.org = patch.org;
    if (patch.aliases != null) p.aliases = patch.aliases;
    p.rev += 1;
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: logChange(world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Edited ${p.display_name}` }) };
  },
  people_merge: (a, { world, emit }) => {
    if (a.source === a.target) throw coreError("invalid_input", "same person", { type: "validation", field: "target", rule: "duplicate" });
    const src = person(world, a.source);
    const dst = person(world, a.target);
    dst.aliases = [...new Set([...dst.aliases, src.display_name, ...src.aliases])];
    dst.open_items += src.open_items;
    dst.rev += 1;
    world.people = world.people.filter((p) => p !== src);
    world.items.forEach((i) => i.owner?.id === src.id && (i.owner = { id: dst.id, display_name: dst.display_name, short_name: dst.short_name, initials: dst.initials, is_you: dst.is_you }));
    emit("entity:changed", { type: "removed", kind: "person", id: src.id });
    emit("entity:changed", { type: "person", person: dst });
    return { person: dst, change_id: logChange(world, { entity: { kind: "person", id: dst.id, label: dst.display_name }, summary: `Merged ${src.display_name} into ${dst.display_name}` }) };
  },
  person_delete: (a, { world, emit }) => {
    const p = person(world, a.person_id);
    if (p.is_you) throw coreError("invalid_input", "cannot delete yourself", { type: "validation", field: "person_id", rule: "invalid_format" });
    world.people = world.people.filter((x) => x !== p);
    world.items.forEach((i) => i.owner?.id === p.id && (i.owner = null));
    emit("entity:changed", { type: "removed", kind: "person", id: p.id });
    return { deleted: 1 };
  },
  voice_profile_create: (a, { world }) => {
    const p = person(world, a.person_id);
    p.voice_profile = true;
    return { person_id: p.id, enabled: true, centroids: a.from_speaker ? 1 : 0, opted_in_at: now() };
  },
  voice_profile_delete: (a, { world }) => {
    const p = person(world, a.person_id);
    p.voice_profile = false;
    return { person_id: p.id, enabled: false, centroids: 0, opted_in_at: null };
  },

  // ── Agents (draft) ───────────────────────────────────────────────────
  agents_get: (_a, { world }) => world.agents,
  agent_create: (a, { world, emit }) => {
    const names = { security_reviewer: "Security reviewer", qa: "QA", customer: "Customer", finance: "Finance", blank: "New agent" } as const;
    const name = a.name?.trim() || names[a.template];
    const base = world.agents.agents[0];
    const ag: AgentView = { ...base, id: newId("agt"), rev: 1, name, badge: "person.crop.circle", builtin: false, enabled: true, order: world.agents.agents.length + 1, budget_share: 0, status: { type: "ok" }, skill_path: `skills/roles/${name.toLowerCase().replace(/\W+/g, "-")}/SKILL.md`, stats: { cards_7d: 0, useful_share: null } };
    world.agents.agents.push(ag);
    emit("entity:changed", { type: "agent", agent: ag });
    return { agent: ag, change_id: logChange(world, { entity: { kind: "agent", id: ag.id, label: ag.name }, summary: `Added agent ${ag.name}` }) };
  },
  agent_update: (a, { world, emit }) => {
    const ag = agent(world, a.agent_id);
    checkRev(ag.rev, a.rev);
    if (a.patch.runtime) {
      const rt = world.agents.runtimes.find((r) => r.runtime === a.patch.runtime);
      if (!rt?.available) throw coreError("runtime_unavailable", "runtime", { type: "runtime", runtime: a.patch.runtime, reason: rt?.reason ?? "no_key", fix: null });
    }
    Object.assign(ag, Object.fromEntries(Object.entries(a.patch).filter(([, v]) => v != null)));
    ag.rev += 1;
    emit("entity:changed", { type: "agent", agent: ag });
    return { agent: ag, change_id: logChange(world, { entity: { kind: "agent", id: ag.id, label: ag.name }, summary: `Changed ${ag.name}` }) };
  },
  agents_reorder: (a, { world }) => {
    const ids = new Set(world.agents.agents.map((x) => x.id));
    if (a.order.length !== ids.size || !a.order.every((id) => ids.has(id))) throw coreError("invalid_input", "order must list every agent once", { type: "validation", field: "order", rule: "invalid_format" });
    a.order.forEach((id, i) => (agent(world, id).order = i + 1));
    world.agents.agents.sort((x, y) => x.order - y.order);
    return world.agents;
  },
  agent_remove: (a, { world, emit }) => {
    const ag = agent(world, a.agent_id);
    if (ag.builtin) throw coreError("invalid_input", "built-in agents can be disabled, not removed", { type: "validation", field: "agent_id", rule: "invalid_format" });
    world.agents.agents = world.agents.agents.filter((x) => x !== ag);
    emit("entity:changed", { type: "removed", kind: "agent", id: ag.id });
    return { deleted: 1 };
  },
  agent_skill_get: (a, { world }) => {
    const ag = agent(world, a.agent_id);
    const s = skills.get(ag.id);
    return { agent_id: ag.id, rev: s?.rev ?? 1, body_md: s?.body ?? defaultSkill(ag), is_default: !s, missing: false };
  },
  agent_skill_save: (a, { world }) => {
    const ag = agent(world, a.agent_id);
    checkRev(skills.get(ag.id)?.rev ?? 1, a.rev);
    if (!a.body_md.trim()) throw coreError("invalid_input", "skill", { type: "validation", field: "body_md", rule: "required" });
    skills.set(ag.id, { rev: a.rev + 1, body: a.body_md });
    return { agent_id: ag.id, rev: a.rev + 1, body_md: a.body_md, is_default: false, missing: false };
  },
  agent_skill_reset: (a, { world }) => {
    const ag = agent(world, a.agent_id);
    const rev = (skills.get(ag.id)?.rev ?? 1) + 1;
    skills.delete(ag.id);
    return { agent_id: ag.id, rev, body_md: defaultSkill(ag), is_default: true, missing: false };
  },
  council_set_mode: (a, { world }) => {
    const row = world.agents.council.find((r) => r.call_type === a.call_type);
    if (row) Object.assign(row, { live: a.live, post_call: a.post_call });
    else world.agents.council.push({ call_type: a.call_type, live: a.live, post_call: a.post_call, agents: [] });
    return world.agents;
  },

  // ── Settings and credentials ─────────────────────────────────────────
  settings_get: (_a, { world }) => world.settings,
  settings_update: (a, { world, publish }) => {
    checkRev(world.settings.rev, a.rev);
    const sec = a.section;
    if (sec.section === "copilot") {
      const m = sec.value.card_keys.modifiers;
      if (!m.control && !m.option && !m.command) throw coreError("invalid_input", "card keys need a modifier", { type: "validation", field: "card_keys.modifiers", rule: "no_modifier" });
    }
    if (sec.section === "audio") sec.value.retention_next_run_deletes = world.settings.audio.retention_next_run_deletes;
    (world.settings as unknown as Record<string, unknown>)[sec.section] = sec.value;
    world.settings.rev += 1;
    if (sec.section === "general") {
      world.app.setup.detection_enabled = sec.value.offer_to_record && world.app.setup.self_test.type === "passed";
      publish("setup:changed");
    }
    publish("settings:changed");
    return world.settings;
  },
  settings_unignore_app: (a, { world, publish }) => {
    const before = world.settings.general.ignored_apps.length;
    world.settings.general.ignored_apps = world.settings.general.ignored_apps.filter((x) => x.bundle_id !== a.bundle_id);
    if (world.settings.general.ignored_apps.length === before) throw coreError("not_found", `app ${a.bundle_id}`);
    world.settings.rev += 1;
    publish("settings:changed");
    return world.settings;
  },
  storage_move: (a) => {
    if (a.path && /Mobile Documents|Dropbox/.test(a.path)) throw coreError("storage_in_cloud_folder");
    return { job_run_id: newId("run") };
  },
  hotkeys_list: (_a, { world }) => world.hotkeys,
  hotkey_set: (a, { world, publish }) => {
    if (a.shortcut && !/(Ctrl|Alt|Super|Shift)\+/.test(a.shortcut)) throw coreError("invalid_input", "no modifier", { type: "validation", field: "shortcut", rule: "no_modifier" });
    if (a.shortcut === "Super+Q" || a.shortcut === "Super+Tab") throw coreError("hotkey_reserved");
    const b = world.hotkeys.bindings.find((x) => x.action === a.action);
    if (!b) throw coreError("not_found", `hotkey ${a.action}`);
    b.shortcut = a.shortcut ?? null;
    b.status = b.shortcut ? (b.action === "undo_card_action" ? { type: "registered_during_capture" } : { type: "registered" }) : { type: "not_set" };
    publish("hotkeys:changed");
    return world.hotkeys;
  },
  hotkeys_reset: (_a, { world, publish }) => {
    world.hotkeys.bindings.forEach((b) => {
      b.shortcut = b.default_shortcut;
      b.status = b.action === "undo_card_action" ? { type: "registered_during_capture" } : { type: "registered" };
    });
    // Restore Defaults covers the card keys too, which live in the copilot settings section.
    world.settings.copilot.card_keys = { enabled: true, modifiers: { control: true, option: true, command: true } };
    world.settings.rev += 1;
    publish("settings:changed");
    publish("hotkeys:changed");
    return world.hotkeys;
  },
  repos_list: (_a, { world }) => world.repos,
  repo_upsert: (a, { world }) => {
    if (!a.key.trim()) throw coreError("invalid_input", "key", { type: "validation", field: "key", rule: "required" });
    const dup = world.repos.mappings.find((m) => m.key === a.key && m.id !== a.id);
    if (dup) throw coreError("invalid_input", "duplicate key", { type: "validation", field: "key", rule: "duplicate" });
    const path = a.local_path ?? `~/projects/${a.key.toLowerCase()}`;
    const existing = a.id ? world.repos.mappings.find((m) => m.id === a.id) : undefined;
    if (a.id && !existing) throw coreError("not_found", `mapping ${a.id}`);
    if (existing) Object.assign(existing, { key: a.key, local_path: path, default_tool: a.default_tool, path_exists: true });
    else world.repos.mappings.push({ id: newId("rep"), key: a.key, local_path: path, default_tool: a.default_tool, path_exists: true });
    return world.repos;
  },
  repo_remove: (a, { world }) => {
    const before = world.repos.mappings.length;
    world.repos.mappings = world.repos.mappings.filter((m) => m.id !== a.id);
    if (world.repos.mappings.length === before) throw coreError("not_found", `mapping ${a.id}`);
    return world.repos;
  },
  glossary_list: (_a, { world }) => world.glossary,
  glossary_upsert: (a, { world }) => {
    if (!a.term.trim()) throw coreError("invalid_input", "term", { type: "validation", field: "term", rule: "required" });
    const existing = a.id ? world.glossary.terms.find((t) => t.id === a.id) : undefined;
    if (a.id && !existing) throw coreError("not_found", `term ${a.id}`);
    if (existing) {
      if (a.rev != null) checkRev(existing.rev, a.rev);
      Object.assign(existing, { term: a.term, variants_latin: a.variants_latin, variants_cyrillic: a.variants_cyrillic, spoken_forms: a.spoken_forms, lang: a.lang ?? null, always_apply: a.always_apply, rev: existing.rev + 1 });
    } else {
      if (world.glossary.terms.some((t) => t.term.toLowerCase() === a.term.toLowerCase())) throw coreError("invalid_input", "duplicate", { type: "validation", field: "term", rule: "duplicate" });
      world.glossary.terms.push({ id: newId("gls"), rev: 1, term: a.term, variants_latin: a.variants_latin, variants_cyrillic: a.variants_cyrillic, spoken_forms: a.spoken_forms, lang: a.lang ?? null, always_apply: a.always_apply, added_from: null });
    }
    return world.glossary;
  },
  glossary_remove: (a, { world }) => {
    const before = world.glossary.terms.length;
    world.glossary.terms = world.glossary.terms.filter((t) => t.id !== a.id);
    if (world.glossary.terms.length === before) throw coreError("not_found", `term ${a.id}`);
    return world.glossary;
  },
  audit_list: (a, { world }) => {
    const rows = world.audit.filter((r) => (a.from == null || r.at >= a.from) && (a.to == null || r.at <= a.to));
    return { rows, next_cursor: null, total: rows.length };
  },
  audit_export: (a) => ({ path: `~/Downloads/Noter privacy log.${a.format === "json" ? "json" : "md"}`, files: 1 }),
  share_test_run: (a, { world }) => ({
    rows: (["call_window", "record_prompt", "main_window", "settings_window", "menu_bar_title"] as const).map((surface) => ({
      surface,
      window_share: "hidden",
      app_share: "hidden",
      display_share: surface === "menu_bar_title" ? "visible" : "depends_on_app",
    })),
    capture_test: !a.run_capture_test ? { type: "not_run" } : live(world.app.capture) ? { type: "blocked_by_call" } : { type: "passed", at: now() },
  }),
  update_install: (_a, { world }) => {
    if (!world.app.environment.update?.ready) throw coreError("not_found", "no update is ready"); // F3: before the recording state
    return ack;
  },
  accounts_get: (_a, { world }) => world.app.accounts,
  api_key_set: (a, { world, publish }) => {
    const key = world.app.accounts.keys.find((k) => k.provider === a.provider);
    if (!key) throw coreError("not_found");
    if (a.key.trim().length < 8 || a.key.includes("bad")) {
      key.status = { type: "rejected", reason: "key_rejected" };
      publish("accounts:changed");
      throw coreError("key_rejected");
    }
    key.status = { type: "configured", verified_at: now() };
    publish("accounts:changed");
    return world.app.accounts;
  },
  api_key_remove: (a, { world, publish }) => {
    const key = world.app.accounts.keys.find((k) => k.provider === a.provider);
    if (!key) throw coreError("not_found");
    key.status = { type: "not_set" };
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_signin_prepare: (a, { world }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    return { provider: a.provider, cli: acc.cli, existing: acc.cli.installed && a.provider === "claude" ? { email: "you@example.com", plan: "Max" } : null, needs_personal_use_confirmation: a.provider === "claude" };
  },
  cli_install: (a, { world, fake, emit, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.cli.tool === a.tool);
    const cli = acc?.cli ?? (world.app.accounts.local.cli.tool === a.tool ? world.app.accounts.local.cli : undefined);
    if (!cli) throw coreError("not_found");
    if (!world.app.environment.online) throw coreError("offline");
    const run = newId("run");
    const row = { id: run, job_id: "job_cli_install", kind: "cli_install" as const, name: `Install ${a.tool}`, started_at: now(), finished_at: null, status: "running" as const, counts: [], error: null, progress: 0 };
    [0.4, 1].forEach((p, i) =>
      fake.later(600 * (i + 1), () => {
        emit("jobs:progress", { run: { ...row, progress: p, status: p === 1 ? "succeeded" : "running", finished_at: p === 1 ? now() : null } });
        if (p === 1) {
          Object.assign(cli, { installed: true, path: `/opt/homebrew/bin/${a.tool}`, version: "1.0.0", supported: true });
          publish("accounts:changed");
        }
      }),
    );
    return { job_run_id: run };
  },
  account_signin_start: (a, { world, fake, emit, publish }) => {
    if (a.provider === "claude" && !a.personal_use_confirmed) throw coreError("personal_use_not_confirmed");
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc?.cli.installed) throw coreError("cli_missing");
    const id = newId("sis");
    const identity = { email: "you@example.com", plan: a.provider === "claude" ? "Max" : "Plus" };
    const steps = ["waiting_for_browser", "signed_in", "checking_plan", "sending_test_request", "done"] as const;
    steps.forEach((step, i) =>
      fake.later(800 * (i + 1), () => {
        if (acc.status.type !== "signing_in" || acc.status.session_id !== id) return;
        emit("signin:progress", { session_id: id, provider: a.provider, step, identity: i ? identity : null, error: null });
        if (step === "done") {
          acc.status = { type: "signed_in", identity, since: now() };
          publish("accounts:changed");
        }
      }),
    );
    acc.status = { type: "signing_in", session_id: id };
    publish("accounts:changed");
    return { id, provider: a.provider, url: "https://example.com/device", code: "ABCD-EFGH", expires_at: now() + 5 * MIN };
  },
  account_signin_cancel: (a, { world, emit, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.status.type === "signing_in" && x.status.session_id === a.session_id);
    if (!acc) throw coreError("not_found", `session ${a.session_id}`);
    acc.status = { type: "not_signed_in" };
    emit("signin:progress", { session_id: a.session_id, provider: acc.provider, step: "waiting_for_browser", identity: null, error: "sign_in_cancelled" });
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_use_existing: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (!acc.cli.installed) throw coreError("cli_missing");
    acc.status = { type: "signed_in", identity: { email: "you@example.com", plan: a.provider === "claude" ? "Max" : "Plus" }, since: now() };
    publish("accounts:changed");
    return world.app.accounts;
  },
  account_bind_agents: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (acc.status.type !== "signed_in") throw coreError("account_signed_out");
    const runtime = a.provider === "claude" ? ("claude_account" as const) : ("chatgpt_account" as const);
    acc.agents = a.agent_ids.map((id) => {
      const ag = agent(world, id);
      ag.runtime = runtime;
      return { id: ag.id, name: ag.name, badge: ag.badge };
    });
    publish("accounts:changed");
    return { accounts: world.app.accounts, change_id: logChange(world, { entity: { kind: "setting", id: "runtimes", label: "Agents' runtime" }, summary: `Moved ${a.agent_ids.length} agents to your ${a.provider} account` }) };
  },
  account_test: (a, { world }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    if (!world.app.environment.online) return { ok: false, latency_ms: null, error: "offline" };
    return acc.status.type === "signed_in" ? { ok: true, latency_ms: 840, error: null } : { ok: false, latency_ms: null, error: "account_signed_out" };
  },
  account_sign_out: (a, { world, publish }) => {
    const acc = world.app.accounts.accounts.find((x) => x.provider === a.provider);
    if (!acc) throw coreError("not_found");
    acc.status = { type: "not_signed_in" };
    acc.agents = [];
    publish("accounts:changed");
    return world.app.accounts;
  },
  sources_list: (_a, { world }) => world.sources,
  source_add_folder: (a, { world, emit }) => {
    const path = a.path ?? "~/Documents/Notes";
    if (world.sources.sources.some((x) => x.location === path)) throw coreError("invalid_input", "already added", { type: "validation", field: "path", rule: "duplicate" });
    const row: SourceRow = { id: newId("src"), rev: 1, kind: "folder", name: path.split("/").at(-1) ?? path, location: path, mode: "indexed", schedule: null, privacy: a.privacy, scope: a.scope, status: { type: "indexing", done: 0, total: 40 }, documents: 0, last_sync_at: null, has_token: false };
    world.sources.sources.push(row);
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_add_mcp: (a, { world, emit }) => {
    if (!a.server.trim()) throw coreError("invalid_input", "server", { type: "validation", field: "server", rule: "required" });
    const row: SourceRow = { id: newId("src"), rev: 1, kind: "mcp", name: a.server, location: a.server, mode: a.mode, schedule: a.schedule ?? null, privacy: a.privacy, scope: a.scope, status: { type: "idle" }, documents: 0, last_sync_at: null, has_token: a.mode === "indexed" };
    world.sources.sources.push(row);
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_update: (a, { world, emit }) => {
    const row = source(world, a.source_id);
    checkRev(row.rev, a.rev);
    if (a.name != null) row.name = a.name;
    if (a.schedule !== undefined) row.schedule = a.schedule;
    if (a.privacy != null) row.privacy = a.privacy;
    if (a.scope != null) row.scope = a.scope;
    row.rev += 1;
    emit("entity:changed", { type: "source", source: row });
    return row;
  },
  source_reindex: (a, { world, fake, emit }) => {
    const row = source(world, a.source_id);
    row.status = { type: "indexing", done: 0, total: row.documents || null };
    fake.later(1000, () => {
      row.status = { type: "idle" };
      row.last_sync_at = now();
      emit("entity:changed", { type: "source", source: row });
    });
    return row;
  },
  source_remove: (a, { world, emit }) => {
    const row = source(world, a.source_id);
    world.sources.sources = world.sources.sources.filter((x) => x !== row);
    emit("entity:changed", { type: "removed", kind: "source", id: row.id });
    return { deleted: 1 };
  },
  source_revoke_token: (a, { world }) => {
    const row = source(world, a.source_id);
    if (!row.has_token) throw coreError("invalid_input", "no token", { type: "validation", field: "source_id", rule: "invalid_format" });
    row.has_token = false;
    row.status = { type: "sign_in_expired" };
    return row;
  },
  jobs_list: (_a, { world }) => ({ ...world.jobs, jobs: world.jobs.jobs.map((j) => ({ ...j, blocked_by_call: j.kind !== "post_call" && live(world.app.capture) })) }),
  // D2: only post-call analysis runs while a call is live.
  job_run_now: (a, { world, fake, emit }) => {
    const j = job(world, a.job_id);
    if (j.kind !== "post_call" && live(world.app.capture)) throw coreError("job_blocked", "a call is live");
    if (j.running) return { job_run_id: j.last_run?.id ?? newId("run") };
    const run = { id: newId("run"), job_id: j.id, kind: j.kind, name: j.name, started_at: now(), finished_at: null, status: "running" as const, counts: [], error: null, progress: 0 };
    j.running = true;
    j.last_run = run;
    emit("jobs:progress", { run });
    fake.later(1000, () => {
      if (!j.running) return;
      j.running = false;
      j.last_run = { ...run, status: "succeeded", finished_at: now(), progress: 1 };
      emit("jobs:progress", { run: j.last_run });
    });
    return { job_run_id: run.id };
  },
  job_cancel: (a, { world, emit }) => {
    const j = job(world, a.job_id);
    if (j.running && j.last_run) {
      j.running = false;
      j.last_run = { ...j.last_run, status: "cancelled", finished_at: now() };
      emit("jobs:progress", { run: j.last_run });
    }
    return world.jobs;
  },
  job_update: (a, { world }) => {
    const j = job(world, a.job_id);
    if (a.enabled != null) j.enabled = a.enabled;
    if (a.allow_on_battery != null) j.allow_on_battery = a.allow_on_battery;
    return world.jobs;
  },

  // ── Performance (draft) ──────────────────────────────────────────────
  perf_overview: (_a, { world }) => world.performance,
  perf_call: (a, { world }) => {
    const c = call(world, a.call_id);
    const stage = (name: string, ms: number, budget: number) => ({ stage: name, ms, budget_ms: budget, state: ms > budget ? ("over" as const) : ms > 0.9 * budget ? ("near" as const) : ("ok" as const) });
    return {
      call: callRef(c),
      ticks: [
        { tick_id: "tick_1", llm_run_id: "llm_tick_1", at_ms: 61_000, trigger: "question", stages: [stage("signals", 180, 250), stage("first_token", 1900, 2000), stage("full_card", 7600, 9000)], late: false, dropped: false },
        { tick_id: "tick_2", llm_run_id: null, at_ms: 122_000, trigger: "topic_change", stages: [stage("signals", 240, 250)], late: false, dropped: true },
      ],
      dropout_ms: 0,
      cost_usd: 0.31,
      tokens_in: 48_200,
      tokens_out: 3_100,
    };
  },
  perf_brief: (a) => ({ path: `~/Downloads/Noter improvement brief (${a.period}).md`, opened_with: a.action.type === "open_in" ? (a.action.target === "codex" ? "codex_app" : "claude_cli_link") : null }),

  // ── First run and permissions ────────────────────────────────────────
  setup_status: (_a, { world }) => world.app.setup,
  models_download: (a, { world, fake, publish }) => {
    const m = world.app.setup.models;
    if (a.action !== "pause" && !world.app.environment.online) throw coreError("offline");
    const corrupt = a.action !== "pause" && fake.corruptDownload; // one shot: the speech bundle fails its check
    if (corrupt) fake.corruptDownload = false;
    if (a.action !== "pause") m.error = null;
    m.bundles.forEach((b) => {
      if (b.state === "ready") return;
      b.state = a.action === "pause" ? "paused" : "downloading";
    });
    publish("setup:changed");
    if (a.action !== "pause") {
      fake.later(800, () => {
        m.bundles.forEach((b) => {
          if (b.state !== "downloading") return;
          if (corrupt && b.required_for_capture) {
            b.state = "checksum_failed";
            m.error = "checksum_failed";
          } else Object.assign(b, { state: "ready", done_mb: b.size_mb });
        });
        m.done_mb = m.bundles.reduce((n, b) => n + b.done_mb, 0);
        publish("setup:changed");
      });
    }
    return world.app.setup;
  },
  permission_request: (a, { world, publish }) => {
    const row = world.app.setup.permissions.find((p) => p.kind === a.kind);
    if (!row) throw coreError("not_found");
    if (row.state === "denied") throw coreError("permission_denied", "turn it on in System Settings", { type: "permission", kind: a.kind });
    row.state = "granted";
    const env = world.app.environment.permissions.find((p) => p.kind === a.kind);
    if (env) env.state = "granted";
    if (a.kind === "notifications") world.app.environment.notifications = "authorized";
    publish("setup:changed");
    publish("env:changed");
    return row;
  },
  self_test_run: (_a, { world, fake, send, publish }) => {
    // D-21: the same refusal as the core (core-first-run inst-if-model-missing), before the Channel opens.
    if (world.app.setup.models.bundles.some((b) => b.required_for_capture && b.state !== "ready")) throw coreError("model_missing", "the live model is not downloaded");
    const sub = newId("sub");
    fake.openChannel(sub, "self_test_run", send as (m: unknown) => void);
    const at = (ms: number, event: Parameters<typeof fake.push<"self_test_run">>[1]["event"]) => fake.later(ms, () => fake.push(sub, { event }));
    at(300, { type: "stream_arrived", channel: "mic" });
    at(600, { type: "stream_arrived", channel: "sys" });
    at(900, { type: "levels", mic_db: -32, sys_db: -28 });
    at(1200, { type: "line", channel: "sys", text: "This is the Noter self-test." });
    at(1500, { type: "passed" });
    fake.later(1500, () => {
      world.app.setup.self_test = { type: "passed", at: now() };
      world.app.setup.detection_enabled = world.settings.general.offer_to_record;
      publish("setup:changed");
    });
    at(1600, { type: "ended", reason: "call_stopped" });
    return { subscription_id: sub };
  },
  setup_set_call_display: (a, { world, publish }) => {
    if (a.display_id && !world.app.environment.displays.some((d) => d.id === a.display_id)) throw coreError("not_found", `display ${a.display_id}`);
    world.app.setup.call_display = a.display_id ?? null;
    world.settings.call_screen.display_id = a.display_id ?? null;
    world.settings.rev += 1;
    publish("settings:changed");
    publish("setup:changed");
    return world.app.setup;
  },
  setup_set_audio_storage: (a, { world, publish }) => {
    world.settings.audio.retention = a.never_store_audio ? "never_store" : a.retention;
    world.settings.rev += 1;
    publish("settings:changed");
    publish("setup:changed");
    return world.app.setup;
  },
  setup_set_step: (a, { world, publish }) => {
    const row = world.app.setup.steps.find((s) => s.step === a.step);
    if (!row) throw coreError("not_found");
    row.state = a.state;
    world.app.setup.complete = world.app.setup.steps.every((s) => s.state !== "todo");
    publish("setup:changed");
    return world.app.setup;
  },

  // ── Windows ──────────────────────────────────────────────────────────
  window_show_call: (_a, { fake, publish }) => {
    // A second request makes it key (PM-40).
    Object.assign(fake.callWindow, { key: fake.callWindow.visible, visible: true });
    publish("window:call");
    return fake.callWindow;
  },
  window_hide_call: (_a, { fake, publish }) => {
    Object.assign(fake.callWindow, { visible: false, key: false });
    publish("window:call");
    return fake.callWindow;
  },
  window_call_state: (_a, { fake }) => fake.callWindow,
  window_share_warning_seen: (_a, { fake, publish }) => {
    fake.callWindow.show_share_warning = false;
    publish("window:call");
    return fake.callWindow;
  },
  window_set_call_layout: (a, { world, fake, publish }) => {
    const twoDisplays = world.app.environment.displays.length > 1;
    fake.callWindow.layout = a.preference === "floating" || !twoDisplays ? "floating" : "dedicated";
    world.settings.call_screen.layout = a.preference;
    publish("window:call");
    return fake.callWindow;
  },
  window_set_collapsed: (a, { fake, publish }) => {
    fake.callWindow.collapsed = a.collapsed;
    publish("window:call");
    return fake.callWindow;
  },
  app_set_hidden_for_presenting: (a, { world, publish }) => {
    world.app.presenting.hidden = a.hidden;
    world.copilot.card_keys.registered = !a.hidden && world.copilot.muted === null && live(world.app.capture);
    publish("app:presenting");
    publish("copilot:status");
    return world.app.presenting;
  },
  window_navigate: (a, { emit }) => {
    if (a.target) emit("nav:request", a.target);
    return ack;
  },
  window_report_view: (a, { fake }) => {
    fake.viewedCall = a.call_id ?? null;
    return ack;
  },
  window_announce: (a) => {
    if (!a.text.trim()) throw coreError("invalid_input", "text", { type: "validation", field: "text", rule: "required" });
    return ack;
  },
  open_external: (a) => {
    if (a.target.type === "url" && !/^https?:\/\//.test(a.target.url)) throw coreError("invalid_input", "http(s) only", { type: "validation", field: "url", rule: "invalid_format" });
    return ack;
  },
};
