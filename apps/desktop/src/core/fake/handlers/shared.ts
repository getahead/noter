// Default handlers of the fake core: one per command of the contract. They implement the
// contract's behaviour rules (rev checks, wanted-state commands, snapshot then stream, undo
// and redo by target, versions on whole-state events, the capture rules of the 17 Oct review)
// over the fixture world, so screens can be built against realistic responses. Stories
// override per test with `new FakeCore({ handlers: { … } })`, `failNext` or `setWorld`.

import type {
  AgentView,
  AskAnswer,
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
  SectionKind,
  SourceRow,
  SpeakerLabel,
  SpeakerView,
  TimestampMs,
  TopicRow,
  TodayView,
  UpcomingCall,
} from "../../bindings";
import { coreError, type FakeCore, type Handlers, type HandlerCtx, type World } from "../fake-core";

export const nextId = (fake: FakeCore, prefix: string) => `${prefix}_fake_${++fake.handlerState.counter}`;
export const now = (): TimestampMs => Date.now();
export const ack = {};
export const MIN = 60_000;

export function must<T extends { id: string }>(rows: readonly T[], id: string, kind: string): T {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw coreError("not_found", `${kind} ${id}`);
  return row;
}

export function personRef(person: Pick<PersonRow, "id" | "display_name" | "short_name" | "initials" | "is_you">) {
  return { id: person.id, display_name: person.display_name, short_name: person.short_name, initials: person.initials, is_you: person.is_you };
}

export function pageRows<T>(page: { cursor?: string | null; limit?: number | null } | undefined, rows: T[]) {
  const limit = Math.min(500, Math.max(1, page?.limit ?? 100));
  const start = page?.cursor == null ? 0 : Number(page.cursor);
  if (!Number.isSafeInteger(start) || start < 0) return { rows: [], next_cursor: null, total: rows.length };
  const slice = rows.slice(start, start + limit);
  return { rows: slice, next_cursor: start + limit < rows.length ? String(start + limit) : null, total: rows.length };
}

// ── helpers ──────────────────────────────────────────────────────────────

export const speakerName = (label: SpeakerLabel): string => label.type === "person" ? label.person.display_name : label.type === "you" ? "You" : label.type === "unnamed" ? `Speaker ${label.n}` : "Guest";

export function speakerLists(world: World, callId: string): SpeakerView[][] {
  return [
    world.transcripts.find((x) => x.call_id === callId)?.speakers,
    world.call_details.find((x) => x.call.id === callId)?.speakers,
  ].filter((list): list is SpeakerView[] => !!list);
}

// @cpt-algo:cpt-noter-algo-core-speakers-audio-correct:p1
export function namedSections(world: World, callId: string, names: [string, string][]): OutputSection[] {
  const replacements = new Map(names.filter(([old, name]) => old && old !== name).map(([old, name]) => [old.replaceAll("<", "&lt;"), name]));
  if (!replacements.size) return [];
  const escaped = [...replacements.keys()].map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${escaped.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  const changed: OutputSection[] = [];
  for (const section of world.outputs.find((o) => o.call_id === callId)?.sections ?? []) {
    if (!section.body_md || !section.writer || section.writer.generated_at > now()) continue;
    const body = section.body_md.replace(pattern, (old) => replacements.get(old)!.replaceAll("<", "&lt;"));
    if (body === section.body_md) continue;
    versionsOf(section).push({ body_md: body, kind: "user_edit" });
    section.body_md = body;
    section.names_updated = true;
    section.rev = (section.rev ?? 0) + 1;
    section.version_count += 1;
    changed.push(section);
  }
  return changed;
}

export function findItem(world: World, id: string): ItemView {
  return must(world.items, id, "item");
}

export function checkRev(current: Rev, sent: Rev): void {
  if (current !== sent) throw coreError("conflict", "rev is stale", { type: "conflict", current_rev: current });
}

export function blankItem(fake: FakeCore, call: CallRow, overrides: Partial<ItemView>): ItemView {
  return {
    id: nextId(fake, "itm"), rev: 1, call: callRef(call), kind: "action_item", text: "",
    lang: call.languages[0] ?? "en", owner: null, due: null, status: "open", review: "accepted",
    created_by: "user", topic: null, is_engineering: false, linked_issue: null, spans: [], handoff: null,
    closed_by: null, done_at: null, owed: "to_you", carried_from: null, edited: false, ...overrides,
  };
}

export type AskRun = { subscription: string; thread: string; question: string; scope: World["ask_threads"][number]["scope"]; text: string; citations: AskAnswer["citations"]; timers: ReturnType<typeof setTimeout>[] };
export const askRuns = new WeakMap<FakeCore, Map<string, AskRun>>();

export type ChangeInput = Pick<ChangeRow, "entity" | "summary"> & Partial<Pick<ChangeRow, "actor" | "field" | "before" | "after" | "reason" | "undoable" | "batch_id">>;

export function logChange(fake: FakeCore, world: World, row: ChangeInput): ChangeId {
  const id = nextId(fake, "chg");
  // A later edit of the same field blocks the redo of an undone change (`edited_later`).
  world.changes.forEach((c) => c.status === "undone" && c.entity.id === row.entity.id && c.field === (row.field ?? null) && (c.redoable = false));
  world.changes.unshift({
    actor: { type: "you" },
    field: null,
    before: null,
    after: null,
    reason: null,
    undoable: true,
    batch_id: null,
    ...row,
    id,
    at: now(),
    batch_size: 1,
    evidence: [],
    confidence: null,
    status: "applied",
    redoable: false,
  });
  return id;
}

export function bump(item: ItemView): ItemView {
  item.rev = item.rev + 1;
  return item;
}

// @cpt-flow:cpt-noter-flow-core-history-undo-read:p1
export function historyRows(world: World, rows: ChangeRow[]): ChangeRow[] {
  // Fixture rows can already summarize a batch; new batches have one stored row per item.
  return rows.map((r) => r.batch_id ? { ...r, batch_size: Math.max(r.batch_size, world.changes.filter((c) => c.batch_id === r.batch_id).length) } : r);
}

export function namingState(world: World, callId: string) {
  const transcript = world.transcripts.find((t) => t.call_id === callId);
  const speakers = (transcript ?? world.call_details.find((d) => d.call.id === callId))?.speakers ?? [];
  const segments = transcript?.segments ?? [];
  const sections = (world.outputs.find((o) => o.call_id === callId)?.sections ?? []).map((section) => ({ section: { ...section, rev: null }, versions: versionsOf(section) }));
  return { callId, speakers, segments, sections };
}

export function isSpeakerChange(row: ChangeRow): boolean {
  return row.entity.kind === "speaker" || row.field === "speakers" || (row.entity.kind === "call" && row.summary.startsWith("Named "));
}

// @cpt-algo:cpt-noter-algo-core-history-undo-replay:p1
export function replayChanges(world: World, rows: ChangeRow[], value: "before" | "after", emit: HandlerCtx<"change_undo">["emit"], fake: FakeCore): void {
  rows.forEach((r) => {
    const call = r.entity.kind === "call" && r.field === "title" ? world.calls.find((c) => c.id === r.entity.id) : undefined;
    if (call) {
      call.title = r[value] ?? "";
      call.rev += 1;
      emit("entity:changed", { type: "call", call });
    }
    const output = r.entity.kind === "summary" && r.field === "body" ? world.outputs.find((o) => o.sections.some((s) => s.summary_id === r.entity.id)) : undefined;
    const summary = output?.sections.find((s) => s.summary_id === r.entity.id);
    if (summary) {
      const body = r[value] ?? "";
      summary.body_md = body;
      summary.user_edited = versionsOf(summary).some((version) => version.body_md === body && version.kind === "user_edit");
      if (summary.rev !== null) summary.rev += 1;
      emit("entity:changed", { type: "section", call_id: output!.call_id, section: summary });
    }
    if (isSpeakerChange(r) && r[value]) {
      const state = JSON.parse(r[value]!) as ReturnType<typeof namingState>;
      for (const speakers of [world.transcripts.find((t) => t.call_id === state.callId)?.speakers, world.call_details.find((d) => d.call.id === state.callId)?.speakers]) {
        if (!speakers) continue;
        for (let i = speakers.length - 1; i >= 0; i--) {
          if (!state.speakers.some((restored) => restored.id === speakers[i]!.id)) speakers.splice(i, 1);
        }
        for (const restored of state.speakers) {
          const speaker = speakers?.find((s) => s.id === restored.id);
          if (speaker) Object.assign(speaker, restored);
          else speakers.push(structuredClone(restored));
        }
      }
      const transcript = world.transcripts.find((t) => t.call_id === state.callId);
      for (const restored of state.segments ?? []) {
        const segment = transcript?.segments.find((s) => s.id === restored.id);
        if (segment) segment.speaker = restored.speaker;
      }
      emit("entity:changed", { type: "speakers", call_id: state.callId, speakers: state.speakers });
      for (const restored of state.sections) {
        const section = world.outputs.find((o) => o.call_id === state.callId)?.sections.find((s) => s.kind === restored.section.kind);
        if (section) {
          Object.assign(section, restored.section, { rev: section.rev === null ? null : section.rev + 1 });
          sectionVersions.set(section, restored.versions);
          emit("entity:changed", { type: "section", call_id: state.callId, section });
        }
      }
    }
    // shortcut: only the undo of a term fix restores its words (a redo keeps the line as it is); the core replays both
    const fixed = value === "before" && r.entity.kind === "segment" && r.field === "text" ? world.transcripts.flatMap((t) => t.segments).find((x) => x.id === r.entity.id) : undefined;
    const fix = fixed?.corrections.slice().reverse().find((c) => fixed.text.slice(c.range.start, c.range.end) === r.after);
    if (fixed && fix) {
      fixed.text = fixed.text.slice(0, fix.range.start) + (r.before ?? "") + fixed.text.slice(fix.range.end);
      const delta = (r.before ?? "").length - (fix.range.end - fix.range.start);
      fixed.corrections = fixed.corrections.filter((correction) => correction !== fix).map((correction) => correction.range.start >= fix.range.end
        ? { ...correction, range: { start: correction.range.start + delta, end: correction.range.end + delta } }
        : correction);
      fake.push("transcript_subscribe", { event: { type: "segments_updated", segments: [fixed] } }); // the stream carries the restored words
    }
    const tagged = r.entity.kind === "call" && r.field === "tags" ? world.calls.find((c) => c.id === r.entity.id) : undefined;
    if (tagged) tagged.tags = JSON.parse(r[value] ?? "[]");
    const item = r.entity.kind === "item" && r.field ? world.items.find((i) => i.id === r.entity.id) : undefined;
    if (item) bump(Object.assign(item, r.field === "status" && r[value]?.startsWith("{")
      ? JSON.parse(r[value]!) : { [r.field === "review_state" ? "review" : r.field as string]: r[value] }));
  });
}

/** A change whose field no longer holds its `after` was edited later, as the core's replay checks it (where the fake keeps the field). */
export function editedLater(world: World, r: ChangeRow): boolean {
  if (isSpeakerChange(r) && r.after) {
    const state = JSON.parse(r.after) as ReturnType<typeof namingState>;
    return JSON.stringify(namingState(world, state.callId)) !== r.after;
  }
  const tagged = r.entity.kind === "call" && r.field === "tags" ? world.calls.find((c) => c.id === r.entity.id) : undefined;
  if (tagged) return JSON.stringify(tagged.tags) !== r.after;
  const item = r.entity.kind === "item" && r.field ? world.items.find((i) => i.id === r.entity.id) : undefined;
  return !!item && (r.field === "status" && r.after?.startsWith("{")
    ? Object.entries(JSON.parse(r.after)).some(([key, value]) => item[key as keyof ItemView] !== value)
    : String((item as Record<string, unknown>)[r.field === "review_state" ? "review" : r.field as string] ?? "") !== (r.after ?? ""));
}

export function call(world: World, id: string): CallRow {
  return must(world.calls, id, "call");
}

export function callRef(c: CallRow): CallRef {
  return { id: c.id, title: c.title, started_at: c.started_at, call_type: c.call_type };
}

// @cpt-flow:cpt-noter-flow-core-speakers-audio-delete:p1
export function removeAudio(fake: FakeCore, world: World, calls: CallRow[], emit: HandlerCtx<"audio_delete">["emit"]): CallRow[] {
  const removed = [...new Set(calls)].filter((c) => !c.audio_deleted);
  removed.forEach((c) => {
    Object.assign(c, { audio_deleted: true, audio_deleted_at: now(), audio_kept_until: null, rev: c.rev + 1 });
    logChange(fake, world, { entity: { kind: "call", id: c.id, label: c.title }, summary: "Deleted the audio of a call", undoable: false });
    emit("entity:changed", { type: "call", call: c });
  });
  return removed;
}

export function itemStatus(item: ItemView, includeReview = false): string {
  return JSON.stringify({ status: item.status, done_at: item.done_at, ...(includeReview ? { review: item.review } : {}) });
}

export function todayNow(world: World): number {
  return Date.parse(world.today.date) + now() % 86_400_000;
}

export function itemChanged(fake: FakeCore, world: World, item: ItemView, emit: (e: "entity:changed", p: { type: "item"; item: ItemView }) => void, summary: string, field: string | null, before: string | null) {
  bump(item);
  emit("entity:changed", { type: "item", item });
  const value = field === "review_state" ? item.review : field ? (item as Record<string, unknown>)[field] : null;
  return { item, change_id: logChange(fake, world, { entity: { kind: "item", id: item.id, label: item.text }, field, before, after: field === "status" && before?.startsWith("{") ? itemStatus(item, "review" in JSON.parse(before)) : value == null ? null : String(value), summary }) };
}

// @cpt-flow:cpt-noter-flow-core-items-today-dashboard:p1
export function todayView(world: World): TodayView {
  const shown = new Set<string>();
  const open = (i: ItemView) => (["open", "carried"].includes(i.status) && i.review !== "rejected")
    || (i.status === "handed_off" && i.review === "accepted");
  const card = (c: UpcomingCall): UpcomingCall => {
    const rows = [...c.items, ...c.questions, ...c.handed_off]
      .map((i) => world.items.find((current) => current.id === i.id) ?? i).filter(open);
    rows.forEach((i) => shown.add(i.id));
    return { ...c, items: rows.filter((i) => i.status !== "handed_off" && i.kind !== "open_question"),
      questions: rows.filter((i) => i.status !== "handed_off" && i.kind === "open_question"),
      handed_off: rows.filter((i) => i.status === "handed_off"), open_count: rows.length };
  };
  const today = world.today.today.map(card);
  const this_week = world.today.this_week.map(card);
  const suggested = world.items.filter((i) => i.review === "suggested");
  const reviewIds = new Set(suggested.map((i) => i.call.id));
  let unnamed_speakers = 0;
  for (const c of world.calls) {
    const transcripts = world.transcripts.filter((t) => t.call_id === c.id);
    const speakers = (transcripts.find((t) => t.pass === "archive") ?? transcripts[0])?.speakers
      ?? world.call_details.find((d) => d.call.id === c.id)?.speakers ?? [];
    const count = speakers.filter((sp) => sp.label.type === "unnamed").length;
    unnamed_speakers += count;
    if (count) reviewIds.add(c.id);
  }
  const dayStart = Date.parse(world.today.date);
  return { ...world.today, ranking: world.settings.today.ranking, today, this_week,
    due_without_call: world.items.filter((i) => open(i) && i.status !== "handed_off" && i.review === "accepted"
      && i.due !== null && i.due <= world.today.date && !shown.has(i.id)),
    done_today: world.items.filter((i) => i.status === "done" && i.done_at !== null
      && i.done_at >= dayStart && i.done_at < dayStart + 86_400_000),
    review_waiting: suggested.length, unnamed_speakers,
    review_calls: world.calls.filter((c) => reviewIds.has(c.id))
      .sort((a, b) => b.started_at - a.started_at || a.id.localeCompare(b.id)).map(callRef),
  };
}

/** A capture is live: recording, paused or still starting. */
export function live(cap: CaptureState): boolean {
  return cap.phase === "recording" || cap.phase === "paused" || cap.phase === "starting" || cap.phase === "failed";
}

export function requireLive(cap: CaptureState, callId: string): void {
  if (cap.call_id !== callId || !live(cap)) throw coreError("not_recording", `no capture running for ${callId}`);
}

export function setCapture(fake: FakeCore, next: Partial<CaptureState>): CaptureState {
  fake.world.app.capture = { ...fake.world.app.capture, ...next };
  fake.publish("capture:state");
  return fake.world.app.capture;
}

export function createCaptureCall(world: World, id: string, title: string, started_at: number, sensitive: boolean): CallRow {
  const template = world.calls[0];
  const row: CallRow = template
    ? { ...template, id, rev: 1, title, started_at, duration_ms: 0, participants: [], unnamed_speakers: 0, languages: [], tags: [], privacy: sensitive ? "sensitive" : "normal", status: "recording", outputs: "not_started", archive: "not_started", audio_kept_until: null, audio_deleted: false, audio_deleted_at: null, audio_retention_days: 30, open_items: 0, review_waiting: 0 }
    : { id, rev: 1, title, call_type: "one_on_one", started_at, duration_ms: 0, platform: null, participants: [], unnamed_speakers: 0, languages: [], tags: [], privacy: sensitive ? "sensitive" : "normal", status: "recording", outputs: "not_started", archive: "not_started", audio_kept_until: null, audio_deleted: false, audio_deleted_at: null, audio_retention_days: 30, open_items: 0, review_waiting: 0 };
  world.calls.unshift(row);
  world.transcripts.push({ subscription_id: null, call_id: id, live: true, pass: "live", archive: "not_started", segments: [], hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: 0, audio_available: true });
  return row;
}

export function findCard(world: World, id: string): CardView {
  const card = world.cards.find((c) => c.id === id);
  if (!card) throw coreError("card_gone", `card ${id}`);
  return card;
}

/** Last card action, for `card_undo_last` (30-second window). */
export function cardAction(fake: FakeCore, card: CardView, item: ItemView | null) {
  fake.handlerState.lastCardAction = { card_id: card.id, state: card.state, number: card.number, item_id: item?.id ?? null, at: now() };
  return card;
}

/** Push on the newest card stream, if a call surface subscribed. */
export function pushCards(fake: FakeCore, body: { event: CardEvent }) {
  fake.push("cards_subscribe", body);
}

export function handoffView(fake: FakeCore, world: World, item: ItemView, state: HandoffView["state"] = { type: "ready" }): HandoffView {
  const repo = world.repos.mappings.find((m) => item.linked_issue?.startsWith(m.key)) ?? null;
  const own = item.owner?.is_you ?? false;
  const edited = fake.handlerState.handoffEdits.get(item.id);
  const target = fake.handlerState.handoffTargets.get(item.id) ?? repo?.default_tool ?? "claude_code";
  const generated = `## Goal\n${item.text}\n\n## Context\nSaid in “${item.call.title}”.\n\nAsk before touching anything outside this scope.`;
  return {
    item,
    state,
    rev: state.type === "ready" ? (fake.handlerState.handoffRevs.get(item.id) ?? 1) : null,
    prompt_md: state.type === "ready" ? (edited ?? generated) : null,
    generated_md: state.type === "ready" ? generated : null,
    edited: edited !== undefined,
    versions: [],
    target,
    repo,
    unmapped_key: repo ? null : (item.linked_issue?.split("-")[0] ?? null),
    launch: { path: !repo ? "none" : target === "codex" ? "terminal" : "claude_cli_link", needs_automation: false, automation_denied: false },
    default_action: item.owner && !own ? "copy_prompt" : "open",
    last: item.handoff,
  };
}
export function requireEngineering(item: ItemView): void {
  if (!item.is_engineering) throw coreError("invalid_input", "not an engineering item", { type: "validation", field: "item_id", rule: "invalid_format" });
}

export function section(world: World, summaryId: string): OutputSection {
  const s = world.outputs.flatMap((o) => o.sections).find((x) => x.summary_id === summaryId);
  if (!s) throw coreError("not_found", `summary ${summaryId}`);
  return s;
}

/** A section's versions, oldest first: the seeded ones carry its written text, as in the real core. */
export const sectionVersions = new WeakMap<OutputSection, { body_md: string; kind: "generated" | "user_edit" }[]>();
export function versionsOf(s: OutputSection): { body_md: string; kind: "generated" | "user_edit" }[] {
  let v = sectionVersions.get(s);
  // An edited section's current (last) version is the user's edit, as in the real core.
  const n = Math.max(1, s.version_count);
  if (!v) sectionVersions.set(s, (v = Array.from({ length: n }, (_, i) => ({ body_md: s.body_md ?? "", kind: s.user_edited && i === n - 1 ? ("user_edit" as const) : ("generated" as const) }))));
  return v;
}

export function topic(world: World, id: string): TopicRow {
  return must(world.topics, id, "topic");
}

export function person(world: World, id: string): PersonRow {
  return must(world.people, id, "person");
}

export function agent(world: World, id: string): AgentView {
  return must(world.agents.agents, id, "agent");
}

export function source(world: World, id: string): SourceRow {
  return must(world.sources.sources, id, "source");
}

export function job(world: World, id: string): JobRow {
  return must(world.jobs.jobs, id, "job");
}

export function copilot(fake: FakeCore, change: (c: CopilotStatus) => void): CopilotStatus {
  change(fake.world.copilot);
  fake.publish("copilot:status");
  return fake.world.copilot;
}

export const defaultSkill = (a: AgentView) => `---\nname: ${a.name}\n---\n\nYou are the ${a.name} of the council. Ask one question at a time; cite the call.`;

/** The call a scripted transcript event belongs to, if it names one. */
/** How many events of the live script each transcript snapshot has had streamed into it. */
export const scriptPlayed = new WeakMap<object, number>();
export const scriptRunning = new WeakSet<object>();

export function scriptCall(e: World["live_script"][number]): string | undefined {
  if ("segment" in e) return e.segment.call_id;
  if ("gap" in e) return e.gap.call_id;
  if ("mark" in e) return e.mark.call_id;
  if ("segments" in e) return e.segments[0]?.call_id;
  if ("speakers" in e) return e.speakers[0]?.call_id;
  return undefined;
}
